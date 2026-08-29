// app/api/rooms/route.ts — the storage map.
//
// Rooms are the count sheet's table of contents: their canvas position
// is cosmetic, their sortOrder is not — it is the walk order between
// rooms, and the count screen renders in it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { ROOM_KINDS } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const rooms = await prisma.storageRoom.findMany({
      where: { restaurantId, active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { items: { where: { active: true } } } } },
    });
    return Response.json({
      rooms: rooms.map((room) => ({
        id: room.id, name: room.name, kind: room.kind,
        x: room.x, y: room.y, w: room.w, h: room.h,
        sortOrder: room.sortOrder, itemCount: room._count.items,
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
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "The room needs a name." }, { status: 400 });
    const kind = ROOM_KINDS.includes(body.kind as never) ? String(body.kind) : "dry";
    const count = await prisma.storageRoom.count({ where: { restaurantId, active: true } });
    const room = await prisma.storageRoom.create({
      data: {
        restaurantId, name, kind,
        // Stagger new rooms so two adds do not stack invisibly.
        x: 40 + (count % 4) * 250, y: 40 + Math.floor(count / 4) * 180,
        sortOrder: count,
      },
    });
    return NextResponse.json({ ok: true, room: { id: room.id, name: room.name, kind: room.kind, x: room.x, y: room.y, w: room.w, h: room.h, sortOrder: room.sortOrder, itemCount: 0 } });
  }

  // One save for the whole canvas when Done editing is pressed —
  // positions are not worth a network call per pixel of drag.
  if (action === "layout") {
    const rooms = Array.isArray(body.rooms) ? body.rooms : [];
    for (const raw of rooms) {
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      await prisma.storageRoom.updateMany({
        where: { id: r.id, restaurantId },
        data: {
          x: Math.max(0, Math.round(Number(r.x) || 0)),
          y: Math.max(0, Math.round(Number(r.y) || 0)),
          w: Math.min(600, Math.max(120, Math.round(Number(r.w) || 220))),
          h: Math.min(500, Math.max(100, Math.round(Number(r.h) || 150))),
          sortOrder: Math.max(0, Math.round(Number(r.sortOrder) || 0)),
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "rename") {
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "The room needs a name." }, { status: 400 });
    await prisma.storageRoom.updateMany({ where: { id: String(body.id), restaurantId }, data: { name } });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    // Soft delete, and only when empty: a room with items on its
    // shelves disappearing from the count sheet is how items silently
    // stop being counted.
    const items = await prisma.inventoryItem.count({ where: { restaurantId, roomId: String(body.id), active: true } });
    if (items > 0) {
      return NextResponse.json({ error: `That room still holds ${items} item${items === 1 ? "" : "s"}. Move or remove them first.` }, { status: 400 });
    }
    await prisma.storageRoom.updateMany({ where: { id: String(body.id), restaurantId }, data: { active: false } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export { corsOptions as OPTIONS } from "@/lib/cors";
