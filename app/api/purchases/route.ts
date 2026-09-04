// app/api/purchases/route.ts — ordering, receiving, and the three-way
// match.
//
// Receiving is where cost rippling STARTS: a line received at a new
// price updates the item's lastCostCents, and because every recipe
// cost and every valuation derives from that column at read time, one
// repriced case of oil reprices every dish that uses oil with no
// propagation job.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { threeWayMatch } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** The restaurant's per-category caps, as a category → % map. Absent
 *  categories fall back to the 2% default inside threeWayMatch. */
async function capMap(restaurantId: string) {
  const caps = await prisma.inventoryCategoryCap.findMany({ where: { restaurantId } });
  return new Map(caps.map((cap) => [cap.category, Number(cap.capPct)]));
}

async function presentPurchase(purchaseId: string, restaurantId: string) {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { lines: { include: { item: { select: { name: true, purchaseUnit: true, lastCostCents: true, category: true, contractPriceCents: true } } } } },
  });
  if (!purchase) return null;
  const caps = await capMap(restaurantId);
  const match = threeWayMatch({
    invoiceTotalCents: purchase.invoiceTotalCents,
    lines: purchase.lines.map((line) => ({
      itemName: line.item.name,
      qtyOrdered: Number(line.qtyOrdered),
      qtyReceived: line.qtyReceived == null ? null : Number(line.qtyReceived),
      unitCostCents: line.unitCostCents,
      previousCostCents: line.item.lastCostCents,
      capPct: caps.get(line.item.category) ?? null,
      contractPriceCents: line.item.contractPriceCents,
    })),
  });
  return {
    id: purchase.id, vendorName: purchase.vendorName, status: purchase.status,
    orderedAt: purchase.orderedAt, receivedAt: purchase.receivedAt, receivedBy: purchase.receivedBy,
    invoiceNumber: purchase.invoiceNumber, invoiceTotalCents: purchase.invoiceTotalCents,
    reconciledAt: purchase.reconciledAt, notes: purchase.notes,
    receivedTotalCents: match.receivedTotalCents,
    problems: match.problems,
    lines: purchase.lines.map((line) => ({
      id: line.id, itemId: line.itemId, itemName: line.item.name,
      purchaseUnit: line.item.purchaseUnit,
      qtyOrdered: Number(line.qtyOrdered),
      qtyReceived: line.qtyReceived == null ? null : Number(line.qtyReceived),
      unitCostCents: line.unitCostCents,
    })),
  };
}

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const one = await prisma.purchase.findFirst({ where: { id, restaurantId }, select: { id: true } });
      if (!one) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return Response.json({ purchase: await presentPurchase(id, restaurantId) });
    }
    const purchases = await prisma.purchase.findMany({
      where: { restaurantId },
      orderBy: { orderedAt: "desc" },
      take: 40,
      include: { _count: { select: { lines: true } } },
    });
    return Response.json({
      purchases: purchases.map((purchase) => ({
        id: purchase.id, vendorName: purchase.vendorName, status: purchase.status,
        orderedAt: purchase.orderedAt, receivedAt: purchase.receivedAt,
        invoiceNumber: purchase.invoiceNumber, invoiceTotalCents: purchase.invoiceTotalCents,
        lineCount: purchase._count.lines,
      })),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "create") {
    const vendorName = String(body.vendorName ?? "").trim();
    if (!vendorName) return NextResponse.json({ error: "Who is this order with?" }, { status: 400 });
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (!rawLines.length) return NextResponse.json({ error: "Add at least one line." }, { status: 400 });

    const purchase = await prisma.purchase.create({ data: { restaurantId, vendorName, notes: body.notes ? String(body.notes) : null } });
    for (const raw of rawLines) {
      const line = raw as Record<string, unknown>;
      const item = await prisma.inventoryItem.findFirst({ where: { id: String(line.itemId), restaurantId, active: true } });
      if (!item) continue;
      const qty = Number(line.qtyOrdered);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      await prisma.purchaseLine.create({
        data: {
          purchaseId: purchase.id, itemId: item.id, qtyOrdered: qty,
          // Ordered at the item's current cost; receiving may reprice.
          unitCostCents: Number.isFinite(Number(line.unitCostCents)) && Number(line.unitCostCents) > 0
            ? Math.round(Number(line.unitCostCents))
            : item.lastCostCents,
        },
      });
    }
    return NextResponse.json({ ok: true, id: purchase.id });
  }

  if (action === "receive") {
    const purchase = await prisma.purchase.findFirst({
      where: { id: String(body.id), restaurantId },
      include: { lines: { include: { item: true } } },
    });
    if (!purchase) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (purchase.status === "reconciled") return NextResponse.json({ error: "Already reconciled." }, { status: 409 });

    const received = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    const caps = await capMap(restaurantId);
    const priceChanges: string[] = [];
    for (const line of purchase.lines) {
      const update = received.find((r) => String(r.lineId) === line.id);
      const qty = update && Number.isFinite(Number(update.qtyReceived)) ? Number(update.qtyReceived) : Number(line.qtyOrdered);
      const cost = update && Number.isFinite(Number(update.unitCostCents)) && Number(update.unitCostCents) > 0
        ? Math.round(Number(update.unitCostCents))
        : line.unitCostCents;
      await prisma.purchaseLine.update({ where: { id: line.id }, data: { qtyReceived: Math.max(0, qty), unitCostCents: cost } });

      // ── the ripple ──
      if (qty > 0 && cost > 0 && cost !== line.item.lastCostCents) {
        const wasCents = line.item.lastCostCents;
        await prisma.inventoryItem.update({ where: { id: line.itemId }, data: { lastCostCents: cost } });
        if (wasCents > 0) {
          const pct = ((cost - wasCents) / wasCents) * 100;
          // The note honours the item category's cap: a produce swing a
          // manager said is normal stays quiet; anything past the cap —
          // or past 2% where no cap is set — is named out loud.
          const cap = caps.get(line.item.category) ?? 2;
          if (Math.abs(pct) >= cap) {
            priceChanges.push(`${line.item.name} ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}%${caps.has(line.item.category) ? ` (cap ${cap}%)` : ""}`);
          }
        }
      }
    }

    await prisma.purchase.update({
      where: { id: purchase.id },
      data: {
        status: "received",
        receivedAt: new Date(),
        receivedBy: String(body.receivedBy ?? "").trim() || "owner",
        invoiceNumber: body.invoiceNumber ? String(body.invoiceNumber).trim() : purchase.invoiceNumber,
        invoiceTotalCents:
          body.invoiceTotalCents == null || body.invoiceTotalCents === ""
            ? purchase.invoiceTotalCents
            : Math.round(Number(body.invoiceTotalCents)),
      },
    });
    await audit({
      restaurantId, action: "purchase.received",
      summary: `Received ${purchase.vendorName} delivery${priceChanges.length ? ` — ${priceChanges.join(", ")}` : ""}`,
      req: request,
    });
    return NextResponse.json({ ok: true, priceChanges, purchase: await presentPurchase(purchase.id, restaurantId) });
  }

  if (action === "reconcile") {
    const purchase = await prisma.purchase.findFirst({ where: { id: String(body.id), restaurantId } });
    if (!purchase) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (purchase.status !== "received") return NextResponse.json({ error: "Receive the delivery first." }, { status: 409 });
    const presented = await presentPurchase(purchase.id, restaurantId);
    // Reconciliation is blocked while the match has problems, unless the
    // caller explicitly says they have looked. Averaging away a $300
    // invoice mismatch is how AP automation gets a bad name.
    if (presented?.problems.length && !body.acknowledge) {
      return NextResponse.json({
        error: "The order, the delivery and the invoice do not agree. Review the differences, then reconcile with acknowledge.",
        problems: presented.problems,
      }, { status: 409 });
    }
    await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "reconciled", reconciledAt: new Date() } });
    await audit({ restaurantId, action: "purchase.reconciled", summary: `Reconciled ${purchase.vendorName} invoice ${purchase.invoiceNumber ?? ""}`.trim(), req: request });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
