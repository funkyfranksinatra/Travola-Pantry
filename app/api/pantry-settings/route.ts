// app/api/pantry-settings/route.ts — Pantry's own knobs.
//
// One number today: the food-cost % this restaurant manages to. It is
// deliberately a target, not a budget model — the whole point is that
// setting it takes ten seconds and every report gains a verdict.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const settings = await prisma.pantrySettings.findUnique({ where: { restaurantId } });
    return Response.json({
      foodCostTargetPct: settings?.foodCostTargetPct == null ? null : Number(settings.foodCostTargetPct),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (String(body.action ?? "") === "set") {
    const raw = body.foodCostTargetPct;
    if (raw == null || raw === "") {
      await prisma.pantrySettings.upsert({
        where: { restaurantId },
        create: { restaurantId, foodCostTargetPct: null },
        update: { foodCostTargetPct: null },
      });
      return NextResponse.json({ ok: true, foodCostTargetPct: null });
    }
    const target = Number(raw);
    // 100% is a restaurant giving food away; 5% is a typo for 50.
    if (!Number.isFinite(target) || target <= 0 || target >= 100) {
      return NextResponse.json({ error: "A food-cost target is a percentage between 0 and 100 — most restaurants aim somewhere in the 25–35 range." }, { status: 400 });
    }
    await prisma.pantrySettings.upsert({
      where: { restaurantId },
      create: { restaurantId, foodCostTargetPct: target },
      update: { foodCostTargetPct: target },
    });
    return NextResponse.json({ ok: true, foodCostTargetPct: target });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
