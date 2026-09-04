// app/api/ordering/route.ts — the order sheet: theoretical on-hand and
// suggested quantities, then one PO per preferred vendor.
//
// The manager's question is "what do we need?", never "what do we need
// from Sysco?" — so the sheet is item-first, and the vendor split
// happens at the end, automatically. The suggestion maths lives in
// lib/ordering.ts (pure, unit-tested); this route's job is to feed it
// honest inputs:
//
//   rate      usage per $1,000 of sales, from the last window between
//             two APPROVED counts — the same window the variance
//             report trusts.
//   on-hand   each item's own latest approved count, plus deliveries
//             since, minus rate × sales since.
//   horizon   trailing 28-day average daily sales × the days this
//             order must cover (consumption + buffer).
//
// An item the maths cannot support gets a REASON, not a zero — a zero
// reads as "don't order", which is exactly wrong for a brand-new item.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { salesCentsBetween } from "@/lib/sales";
import { usagePer1000, theoreticalOnHand, suggestOrder, forecastSalesCents } from "@/lib/ordering";
import { purchaseToCount } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const TRAILING_DAYS = 28;

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const horizonDays = Math.min(60, Math.max(1, Number(url.searchParams.get("horizon")) || 7));
    const bufferDays = Math.min(14, Math.max(0, Number(url.searchParams.get("buffer")) || 0));
    const now = new Date();

    // ── The rate window: the two most recent approved counts ──
    const bookends = await prisma.inventoryCount.findMany({
      where: { restaurantId, status: "approved" },
      orderBy: { approvedAt: "desc" },
      take: 2,
      include: { lines: true },
    });

    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId, active: true },
      include: { room: { select: { name: true } } },
      orderBy: [{ roomId: "asc" }, { sortOrder: "asc" }],
    });

    // Trailing sales → the horizon forecast. One number for the whole
    // sheet: the forecast seam VolumePredictor will replace one day.
    const trailingFrom = new Date(now.getTime() - TRAILING_DAYS * 86_400_000);
    const trailingSalesCents = await salesCentsBetween(restaurantId, trailingFrom, now);
    const horizonSalesCents = forecastSalesCents(trailingSalesCents, TRAILING_DAYS, horizonDays + bufferDays);

    if (bookends.length < 2 || !bookends[0].approvedAt || !bookends[1].approvedAt) {
      return Response.json({
        ready: false,
        reason: "Suggestions need two approved counts to learn each item's usage rate. Approve a second count and the sheet fills in.",
        horizonDays, bufferDays,
        rows: [],
      });
    }

    const [closing, opening] = bookends; // newest first
    const fromAt = opening.approvedAt as Date;
    const toAt = closing.approvedAt as Date;

    // Window usage inputs, mirroring the variance engine exactly — the
    // rate must come from the same arithmetic the variance report shows,
    // or the two screens will argue with each other.
    const openQty = new Map(opening.lines.map((line) => [line.itemId, Number(line.quantity)]));
    const closeQty = new Map(closing.lines.map((line) => [line.itemId, Number(line.quantity)]));
    const receivedWindow = await prisma.$queryRawUnsafe<Array<{ itemId: string; qty: unknown }>>(
      `SELECT pl."itemId", SUM(COALESCE(pl."qtyReceived", pl."qtyOrdered")) AS qty
         FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
        WHERE p."restaurantId" = $1 AND p."receivedAt" IS NOT NULL
          AND p."receivedAt" >= $2 AND p."receivedAt" <= $3
        GROUP BY pl."itemId"`,
      restaurantId, fromAt, toAt,
    );
    const receivedWindowQty = new Map(receivedWindow.map((row) => [row.itemId, Number(row.qty)]));
    const windowSalesCents = await salesCentsBetween(restaurantId, fromAt, toAt);

    // ── Each item's own anchor: its latest approved count line ──
    const anchors = await prisma.$queryRawUnsafe<Array<{ itemId: string; quantity: unknown; approvedAt: Date }>>(
      `SELECT DISTINCT ON (l."itemId") l."itemId", l.quantity, c."approvedAt"
         FROM "InventoryCountLine" l JOIN "InventoryCount" c ON c.id = l."countId"
        WHERE c."restaurantId" = $1 AND c.status = 'approved'
        ORDER BY l."itemId", c."approvedAt" DESC`,
      restaurantId,
    );
    const anchor = new Map(anchors.map((row) => [row.itemId, { qty: Number(row.quantity), at: new Date(row.approvedAt) }]));

    // Deliveries since the OLDEST anchor, filtered per item in JS — the
    // set of distinct anchor times is tiny (counts are shared events).
    const oldestAnchor = anchors.length
      ? new Date(Math.min(...anchors.map((row) => new Date(row.approvedAt).getTime())))
      : now;
    const receivedSinceRows = await prisma.$queryRawUnsafe<Array<{ itemId: string; qty: unknown; receivedAt: Date }>>(
      `SELECT pl."itemId", SUM(COALESCE(pl."qtyReceived", pl."qtyOrdered")) AS qty, p."receivedAt"
         FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
        WHERE p."restaurantId" = $1 AND p."receivedAt" IS NOT NULL AND p."receivedAt" > $2
        GROUP BY pl."itemId", p."receivedAt"`,
      restaurantId, oldestAnchor,
    );

    // Sales since each distinct anchor time — one query per distinct
    // timestamp, of which there are as many as there are counts, not items.
    const distinctAnchorTimes = [...new Set(anchors.map((row) => new Date(row.approvedAt).getTime()))];
    const salesSinceByTime = new Map<number, number>();
    for (const time of distinctAnchorTimes) {
      salesSinceByTime.set(time, await salesCentsBetween(restaurantId, new Date(time), now));
    }

    const rows = items.map((item) => {
      const spec = { countPerPurchase: Number(item.countPerPurchase), usagePerCount: Number(item.usagePerCount), lastCostCents: item.lastCostCents };
      const inBoth = openQty.has(item.id) && closeQty.has(item.id);
      const windowUsage = inBoth
        ? openQty.get(item.id)! + purchaseToCount(spec, receivedWindowQty.get(item.id) ?? 0) - closeQty.get(item.id)!
        : null;
      const rate = usagePer1000({ windowUsageCount: windowUsage, windowSalesCents });

      const itemAnchor = anchor.get(item.id) ?? null;
      const receivedSince = itemAnchor
        ? receivedSinceRows
            .filter((row) => row.itemId === item.id && new Date(row.receivedAt) > itemAnchor.at)
            .reduce((sum, row) => sum + Number(row.qty), 0)
        : 0;
      const onHand = theoreticalOnHand({
        lastCountQty: itemAnchor?.qty ?? null,
        receivedPurchaseQtySince: receivedSince,
        salesCentsSince: itemAnchor ? salesSinceByTime.get(itemAnchor.at.getTime()) ?? 0 : 0,
        ratePer1000: rate.rate,
        spec,
      });
      const suggestion = suggestOrder({ onHandCount: onHand.onHand, ratePer1000: rate.rate, horizonSalesCents, spec });

      return {
        itemId: item.id, name: item.name, roomName: item.room.name, category: item.category,
        purchaseUnit: item.purchaseUnit, countUnit: item.countUnit,
        preferredVendor: item.preferredVendor, lastCostCents: item.lastCostCents,
        parLevel: item.parLevel == null ? null : Number(item.parLevel),
        isKeyItem: item.isKeyItem,
        lastCountQty: itemAnchor?.qty ?? null,
        lastCountAt: itemAnchor?.at ?? null,
        ratePer1000: rate.rate,
        onHandCount: onHand.onHand,
        // The first reason that blocks a suggestion — printed, not hidden.
        reason: rate.rate == null ? rate.reason : onHand.onHand == null ? onHand.reason : undefined,
        suggestedPurchaseQty: suggestion?.purchaseQty ?? null,
        neededCount: suggestion?.neededCount ?? null,
        estCostCents: suggestion ? suggestion.purchaseQty * item.lastCostCents : null,
      };
    });

    // Items with something to say first: suggestions by cost, then the
    // rest alphabetically. The blocked items sit at the bottom with
    // their reasons — visible, because "why is beef missing" is a
    // support ticket and a printed reason is not.
    rows.sort((a, b) =>
      (b.estCostCents ?? -1) - (a.estCostCents ?? -1) || a.name.localeCompare(b.name));

    return Response.json({
      ready: true,
      horizonDays, bufferDays,
      window: { from: fromAt, to: toAt, salesCents: windowSalesCents },
      forecast: { trailingDays: TRAILING_DAYS, trailingSalesCents, horizonSalesCents },
      rows,
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // One click, one PO per vendor. The client sends the grouping it
  // showed the user — the server re-validates every item and price.
  if (String(body.action ?? "") === "create") {
    const orders = Array.isArray(body.orders) ? (body.orders as Array<Record<string, unknown>>) : [];
    if (!orders.length) return NextResponse.json({ error: "Nothing to order." }, { status: 400 });

    const created: Array<{ id: string; vendorName: string; lineCount: number }> = [];
    for (const order of orders) {
      const vendorName = String(order.vendorName ?? "").trim();
      if (!vendorName) return NextResponse.json({ error: "Every order needs a vendor name." }, { status: 400 });
      const rawLines = Array.isArray(order.lines) ? (order.lines as Array<Record<string, unknown>>) : [];
      const lines: Array<{ itemId: string; qty: number; unitCostCents: number }> = [];
      for (const raw of rawLines) {
        const item = await prisma.inventoryItem.findFirst({ where: { id: String(raw.itemId), restaurantId, active: true } });
        const qty = Number(raw.qtyOrdered);
        if (!item || !Number.isFinite(qty) || qty <= 0) continue;
        lines.push({ itemId: item.id, qty, unitCostCents: item.lastCostCents });
      }
      if (!lines.length) continue;
      const purchase = await prisma.purchase.create({
        data: {
          restaurantId, vendorName,
          notes: "From the order sheet",
          lines: { create: lines.map((line) => ({ itemId: line.itemId, qtyOrdered: line.qty, unitCostCents: line.unitCostCents })) },
        },
      });
      created.push({ id: purchase.id, vendorName, lineCount: lines.length });
    }
    if (!created.length) return NextResponse.json({ error: "No valid lines to order." }, { status: 400 });
    await audit({
      restaurantId, action: "ordering.created",
      summary: `Order sheet became ${created.length} purchase order${created.length === 1 ? "" : "s"}: ${created.map((c) => c.vendorName).join(", ")}`,
      req: request,
    });
    return NextResponse.json({ ok: true, created });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
