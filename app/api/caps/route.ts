// app/api/caps/route.ts — per-category price-move caps.
//
// One number per category: the allowed ± % move on a received price
// before the three-way match flags it. Categories with no row use the
// 2% default, so an untouched Settings page behaves exactly as the app
// did before caps existed.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { ITEM_CATEGORIES } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const caps = await prisma.inventoryCategoryCap.findMany({
      where: { restaurantId },
      orderBy: { category: "asc" },
    });
    return Response.json({
      caps: caps.map((cap) => ({ category: cap.category, capPct: Number(cap.capPct) })),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const category = String(body.category ?? "");

  if (!ITEM_CATEGORIES.includes(category as never)) {
    return NextResponse.json({ error: "That is not a category." }, { status: 400 });
  }

  if (action === "set") {
    const capPct = Number(body.capPct);
    if (!Number.isFinite(capPct) || capPct <= 0 || capPct > 1000) {
      return NextResponse.json({ error: "The cap is a percentage above zero — 10 means a 10% move gets flagged." }, { status: 400 });
    }
    await prisma.inventoryCategoryCap.upsert({
      where: { restaurantId_category: { restaurantId, category } },
      create: { restaurantId, category, capPct },
      update: { capPct },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    await prisma.inventoryCategoryCap.deleteMany({ where: { restaurantId, category } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
