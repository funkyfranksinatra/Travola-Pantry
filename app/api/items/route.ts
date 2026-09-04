// app/api/items/route.ts — what lives on each shelf.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { ITEM_KINDS, ITEM_CATEGORIES, costPerCountCents, validateItem } from "@/lib/inventory";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function present(item: {
  id: string; roomId: string; name: string; kind: string;
  purchaseUnit: string; countUnit: string; usageUnit: string;
  countPerPurchase: unknown; usagePerCount: unknown;
  lastCostCents: number; parLevel: unknown; isKeyItem: boolean; sortOrder: number;
  category: string; preferredVendor: string; contractPriceCents: number | null;
}) {
  const spec = {
    countPerPurchase: Number(item.countPerPurchase),
    usagePerCount: Number(item.usagePerCount),
    lastCostCents: item.lastCostCents,
  };
  return {
    id: item.id, roomId: item.roomId, name: item.name, kind: item.kind,
    purchaseUnit: item.purchaseUnit, countUnit: item.countUnit, usageUnit: item.usageUnit,
    countPerPurchase: spec.countPerPurchase, usagePerCount: spec.usagePerCount,
    lastCostCents: item.lastCostCents,
    costPerCountCents: Math.round(costPerCountCents(spec) * 100) / 100,
    parLevel: item.parLevel == null ? null : Number(item.parLevel),
    isKeyItem: item.isKeyItem, sortOrder: item.sortOrder,
    category: item.category, preferredVendor: item.preferredVendor,
    contractPriceCents: item.contractPriceCents,
  };
}

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room");
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId, active: true, ...(roomId ? { roomId } : {}) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return Response.json({ items: items.map(present) });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "create" || action === "update") {
    const problems = validateItem(body);
    if (problems.length) return NextResponse.json({ error: problems[0].message, fields: problems }, { status: 400 });

    const data = {
      name: String(body.name).trim(),
      kind: ITEM_KINDS.includes(body.kind as never) ? String(body.kind) : "food",
      purchaseUnit: String(body.purchaseUnit ?? "case").trim() || "case",
      countUnit: String(body.countUnit ?? "each").trim() || "each",
      usageUnit: String(body.usageUnit ?? "each").trim() || "each",
      countPerPurchase: num(body.countPerPurchase, 1),
      usagePerCount: num(body.usagePerCount, 1),
      lastCostCents: Math.round(num(body.lastCostCents, 0)),
      parLevel: body.parLevel == null || body.parLevel === "" ? null : num(body.parLevel, 0),
      isKeyItem: Boolean(body.isKeyItem),
      category: ITEM_CATEGORIES.includes(body.category as never) ? String(body.category) : "other",
      preferredVendor: String(body.preferredVendor ?? "").trim().slice(0, 80),
      contractPriceCents:
        body.contractPriceCents == null || body.contractPriceCents === ""
          ? null
          : Math.max(0, Math.round(num(body.contractPriceCents, 0))) || null,
    };

    if (action === "create") {
      const roomId = String(body.roomId ?? "");
      const room = await prisma.storageRoom.findFirst({ where: { id: roomId, restaurantId, active: true } });
      if (!room) return NextResponse.json({ error: "That room does not exist." }, { status: 400 });
      const count = await prisma.inventoryItem.count({ where: { restaurantId, roomId, active: true } });
      const item = await prisma.inventoryItem.create({ data: { restaurantId, roomId, sortOrder: count, ...data } });
      return NextResponse.json({ ok: true, item: present(item) });
    }
    const updated = await prisma.inventoryItem.updateMany({ where: { id: String(body.id), restaurantId }, data });
    if (!updated.count) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    const item = await prisma.inventoryItem.findUnique({ where: { id: String(body.id) } });
    return NextResponse.json({ ok: true, item: item ? present(item) : null });
  }

  // Shelf-to-sheet: persist the walk order within a room.
  if (action === "reorder") {
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    for (let i = 0; i < ids.length; i += 1) {
      await prisma.inventoryItem.updateMany({ where: { id: ids[i], restaurantId }, data: { sortOrder: i } });
    }
    return NextResponse.json({ ok: true });
  }

  // Duplicate consolidation. Two "Ground beef" items split every count,
  // recipe and delivery between them, and both numbers read as wrong.
  // The merge repoints history at the survivor and retires the twin —
  // where both items appear in the SAME count, recipe or order, the
  // quantities are summed rather than one being dropped.
  if (action === "merge") {
    const fromId = String(body.id ?? "");
    const intoId = String(body.intoId ?? "");
    if (!fromId || !intoId || fromId === intoId) {
      return NextResponse.json({ error: "Pick a different item to merge into." }, { status: 400 });
    }
    const [from, into] = await Promise.all([
      prisma.inventoryItem.findFirst({ where: { id: fromId, restaurantId } }),
      prisma.inventoryItem.findFirst({ where: { id: intoId, restaurantId, active: true } }),
    ]);
    if (!from || !into) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    // Units are the meaning of every historical quantity. "3 cases" of
    // one item and "3 lb" of another cannot be summed, so a merge across
    // different units is refused rather than silently corrupting history.
    if (from.countUnit !== into.countUnit || from.usageUnit !== into.usageUnit || from.purchaseUnit !== into.purchaseUnit) {
      return NextResponse.json({
        error: `These items use different units (${from.purchaseUnit}/${from.countUnit}/${from.usageUnit} vs ${into.purchaseUnit}/${into.countUnit}/${into.usageUnit}). Align the units first, then merge.`,
      }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      // Recipe lines — sum where both items appear in one recipe.
      const recipeLines = await tx.recipeLine.findMany({ where: { itemId: from.id } });
      for (const line of recipeLines) {
        const clash = await tx.recipeLine.findUnique({ where: { recipeId_itemId: { recipeId: line.recipeId, itemId: into.id } } });
        if (clash) {
          await tx.recipeLine.update({ where: { id: clash.id }, data: { quantity: Number(clash.quantity) + Number(line.quantity) } });
          await tx.recipeLine.delete({ where: { id: line.id } });
        } else {
          await tx.recipeLine.update({ where: { id: line.id }, data: { itemId: into.id } });
        }
      }
      // Count lines — sum quantity and value where both were counted.
      const countLines = await tx.inventoryCountLine.findMany({ where: { itemId: from.id } });
      for (const line of countLines) {
        const clash = await tx.inventoryCountLine.findUnique({ where: { countId_itemId: { countId: line.countId, itemId: into.id } } });
        if (clash) {
          await tx.inventoryCountLine.update({
            where: { id: clash.id },
            data: { quantity: Number(clash.quantity) + Number(line.quantity), valueCents: clash.valueCents + line.valueCents },
          });
          await tx.inventoryCountLine.delete({ where: { id: line.id } });
        } else {
          await tx.inventoryCountLine.update({ where: { id: line.id }, data: { itemId: into.id } });
        }
      }
      // Purchase lines — sum quantities; the survivor's price stands.
      const purchaseLines = await tx.purchaseLine.findMany({ where: { itemId: from.id } });
      for (const line of purchaseLines) {
        const clash = await tx.purchaseLine.findUnique({ where: { purchaseId_itemId: { purchaseId: line.purchaseId, itemId: into.id } } });
        if (clash) {
          await tx.purchaseLine.update({
            where: { id: clash.id },
            data: {
              qtyOrdered: Number(clash.qtyOrdered) + Number(line.qtyOrdered),
              qtyReceived: clash.qtyReceived == null && line.qtyReceived == null
                ? null
                : Number(clash.qtyReceived ?? 0) + Number(line.qtyReceived ?? 0),
            },
          });
          await tx.purchaseLine.delete({ where: { id: line.id } });
        } else {
          await tx.purchaseLine.update({ where: { id: line.id }, data: { itemId: into.id } });
        }
      }
      await tx.wasteEvent.updateMany({ where: { itemId: from.id }, data: { itemId: into.id } });
      await tx.inventoryItem.update({ where: { id: from.id }, data: { active: false } });
    });
    await audit({
      restaurantId, action: "item.merged",
      summary: `Merged "${from.name}" into "${into.name}" — counts, recipes, orders and waste now point at one item`,
      req: request,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    // Soft delete. History (count lines, purchase lines) keeps its
    // snapshots and its foreign keys; the item just stops appearing.
    await prisma.inventoryItem.updateMany({ where: { id: String(body.id), restaurantId }, data: { active: false } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export { corsOptions as OPTIONS } from "@/lib/cors";
