// app/api/items/route.ts — what lives on each shelf.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { ITEM_KINDS, costPerCountCents, validateItem } from "@/lib/inventory";

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

  if (action === "remove") {
    // Soft delete. History (count lines, purchase lines) keeps its
    // snapshots and its foreign keys; the item just stops appearing.
    await prisma.inventoryItem.updateMany({ where: { id: String(body.id), restaurantId }, data: { active: false } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export { corsOptions as OPTIONS } from "@/lib/cors";
