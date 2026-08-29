// app/api/counts/route.ts — counting, submission, and approval.
//
// The lifecycle is draft → submitted → approved | rejected, and the
// approval step is the load-bearing one: a count REPRICES THE BUILDING.
// Valuation, usage and variance all flow from it, so a second pair of
// eyes stands between a 1am count and every number derived from it.
// Staff can create, edit and submit; only an approved count is ever
// read by the variance engine or the valuation.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { isOutlier, lineValueCents, validateQuantity } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const COUNT_TYPES = ["full", "key", "room", "spot"] as const;

function presentCount(count: {
  id: string; status: string; type: string; countedBy: string; notes: string | null;
  submittedAt: Date | null; approvedBy: string | null; approvedAt: Date | null;
  rejectReason: string | null; totalValueCents: number; createdAt: Date;
  lines?: Array<{ itemId: string; quantity: unknown; itemName: string; roomName: string; countUnit: string; unitCostCents: number; valueCents: number }>;
}) {
  return {
    id: count.id, status: count.status, type: count.type, countedBy: count.countedBy,
    notes: count.notes, submittedAt: count.submittedAt, approvedBy: count.approvedBy,
    approvedAt: count.approvedAt, rejectReason: count.rejectReason,
    totalValueCents: count.totalValueCents, createdAt: count.createdAt,
    lines: (count.lines ?? []).map((line) => ({
      itemId: line.itemId, quantity: Number(line.quantity), itemName: line.itemName,
      roomName: line.roomName, countUnit: line.countUnit,
      unitCostCents: line.unitCostCents, valueCents: line.valueCents,
    })),
  };
}

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const count = await prisma.inventoryCount.findFirst({
        where: { id, restaurantId },
        include: { lines: { orderBy: { createdAt: "asc" } } },
      });
      if (!count) return NextResponse.json({ error: "Count not found." }, { status: 404 });

      // The previous approved quantity per item, for the outlier guard.
      const previous = await prisma.$queryRawUnsafe<Array<{ itemId: string; quantity: unknown }>>(
        `SELECT DISTINCT ON (l."itemId") l."itemId", l.quantity
           FROM "InventoryCountLine" l
           JOIN "InventoryCount" c ON c.id = l."countId"
          WHERE c."restaurantId" = $1 AND c.status = 'approved' AND c.id <> $2
          ORDER BY l."itemId", c."approvedAt" DESC`,
        restaurantId, id,
      );
      return Response.json({
        count: presentCount(count),
        previousQuantities: Object.fromEntries(previous.map((row) => [row.itemId, Number(row.quantity)])),
      });
    }

    const counts = await prisma.inventoryCount.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { _count: { select: { lines: true } } },
    });
    return Response.json({
      counts: counts.map((count) => ({ ...presentCount(count), lineCount: count._count.lines })),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "start") {
    const type = COUNT_TYPES.includes(body.type as never) ? String(body.type) : "spot";
    const countedBy = String(body.countedBy ?? "").trim() || "staff";
    const count = await prisma.inventoryCount.create({
      data: { restaurantId, type, countedBy, status: "draft" },
    });
    return NextResponse.json({ ok: true, id: count.id });
  }

  // ── set one line. Autosaved per entry so a dead phone battery in the
  // walk-in costs one keystroke, not the count. ──
  if (action === "line") {
    const countId = String(body.countId ?? "");
    const count = await prisma.inventoryCount.findFirst({ where: { id: countId, restaurantId } });
    if (!count) return NextResponse.json({ error: "Count not found." }, { status: 404 });
    if (count.status !== "draft") {
      return NextResponse.json({ error: "This count has been submitted. Start a new one to change it." }, { status: 409 });
    }
    const item = await prisma.inventoryItem.findFirst({
      where: { id: String(body.itemId), restaurantId, active: true },
      include: { room: true },
    });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

    const quantity = validateQuantity(body.quantity);
    if (quantity === null || Number.isNaN(quantity)) {
      return NextResponse.json({ error: "Quantity must be zero or more." }, { status: 400 });
    }
    const spec = {
      countPerPurchase: Number(item.countPerPurchase),
      usagePerCount: Number(item.usagePerCount),
      lastCostCents: item.lastCostCents,
    };
    const unitCost = Math.round((spec.lastCostCents / Math.max(spec.countPerPurchase, 1e-9)));
    await prisma.inventoryCountLine.upsert({
      where: { countId_itemId: { countId, itemId: item.id } },
      create: {
        countId, itemId: item.id, quantity,
        itemName: item.name, roomName: item.room.name, countUnit: item.countUnit,
        unitCostCents: unitCost, valueCents: lineValueCents(spec, quantity),
      },
      update: { quantity, valueCents: lineValueCents(spec, quantity), unitCostCents: unitCost },
    });

    // The outlier check answers on the same round-trip as the save, so
    // the challenge lands while the counter is still at the shelf.
    const prev = await prisma.$queryRawUnsafe<Array<{ quantity: unknown }>>(
      `SELECT l.quantity FROM "InventoryCountLine" l
         JOIN "InventoryCount" c ON c.id = l."countId"
        WHERE c."restaurantId" = $1 AND c.status = 'approved' AND l."itemId" = $2
        ORDER BY c."approvedAt" DESC LIMIT 1`,
      restaurantId, item.id,
    );
    const previous = prev.length ? Number(prev[0].quantity) : null;
    return NextResponse.json({
      ok: true,
      outlier: isOutlier(quantity, previous),
      previous,
    });
  }

  if (action === "submit") {
    const count = await prisma.inventoryCount.findFirst({
      where: { id: String(body.countId), restaurantId },
      include: { _count: { select: { lines: true } } },
    });
    if (!count) return NextResponse.json({ error: "Count not found." }, { status: 404 });
    if (count.status !== "draft") return NextResponse.json({ error: "Already submitted." }, { status: 409 });
    if (count._count.lines === 0) return NextResponse.json({ error: "Nothing has been counted yet." }, { status: 400 });
    await prisma.inventoryCount.update({
      where: { id: count.id },
      data: { status: "submitted", submittedAt: new Date(), notes: body.notes ? String(body.notes) : count.notes },
    });
    await audit({ restaurantId, action: "count.submitted", summary: `${count.countedBy} submitted a ${count.type} count`, req: request });
    return NextResponse.json({ ok: true });
  }

  // ── approval: the moment the count becomes truth ──
  if (action === "approve" || action === "reject") {
    const count = await prisma.inventoryCount.findFirst({
      where: { id: String(body.countId), restaurantId },
      include: { lines: true },
    });
    if (!count) return NextResponse.json({ error: "Count not found." }, { status: 404 });
    if (count.status !== "submitted") {
      return NextResponse.json({ error: "Only a submitted count can be approved or rejected." }, { status: 409 });
    }

    if (action === "reject") {
      await prisma.inventoryCount.update({
        where: { id: count.id },
        data: { status: "rejected", rejectReason: String(body.reason ?? "").trim() || "Rejected." },
      });
      await audit({ restaurantId, action: "count.rejected", summary: `Rejected ${count.countedBy}'s count`, req: request });
      return NextResponse.json({ ok: true });
    }

    // Valuation is frozen INTO the count at approval — the sum of line
    // values as they were counted. Repricing an item next week must
    // not rewrite what the shelves were worth this morning.
    const total = count.lines.reduce((sum, line) => sum + line.valueCents, 0);
    await prisma.inventoryCount.update({
      where: { id: count.id },
      data: {
        status: "approved",
        approvedBy: String(body.approvedBy ?? "owner"),
        approvedAt: new Date(),
        totalValueCents: total,
      },
    });
    await audit({
      restaurantId, action: "count.approved",
      summary: `Approved ${count.countedBy}'s ${count.type} count — ${count.lines.length} items, $${(total / 100).toFixed(2)} on hand`,
      req: request,
    });
    return NextResponse.json({ ok: true, totalValueCents: total });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export { corsOptions as OPTIONS } from "@/lib/cors";
