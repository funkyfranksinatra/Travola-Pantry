// app/api/waste/route.ts — the waste log.
//
// Logged in the moment or not at all, so the endpoint is one action
// with four fields. Waste is what turns a variance from an accusation
// into an explanation: 6 lb of beef in the bin WITH A REASON is not
// 6 lb missing.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { WASTE_REASONS, lineValueCents } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const events = await prisma.wasteEvent.findMany({
      where: { restaurantId },
      orderBy: { occurredAt: "desc" },
      take: 50,
      include: { item: { select: { name: true, countUnit: true } } },
    });
    return Response.json({
      events: events.map((event) => ({
        id: event.id, itemName: event.item.name, countUnit: event.item.countUnit,
        quantity: Number(event.quantity), reason: event.reason,
        valueCents: event.valueCents, note: event.note, recordedBy: event.recordedBy,
        occurredAt: event.occurredAt,
      })),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try { restaurantId = requireRestaurant(request); } catch (error) { return error as Response; }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const item = await prisma.inventoryItem.findFirst({ where: { id: String(body.itemId), restaurantId, active: true } });
  if (!item) return NextResponse.json({ error: "Pick an item." }, { status: 400 });
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "How much went in the bin?" }, { status: 400 });
  const reason = WASTE_REASONS.includes(body.reason as never) ? String(body.reason) : "spoilage";

  const spec = { countPerPurchase: Number(item.countPerPurchase), usagePerCount: Number(item.usagePerCount), lastCostCents: item.lastCostCents };
  const event = await prisma.wasteEvent.create({
    data: {
      restaurantId, itemId: item.id, quantity, reason,
      valueCents: lineValueCents(spec, quantity),
      note: body.note ? String(body.note).trim() : null,
      recordedBy: String(body.recordedBy ?? "").trim() || "staff",
    },
  });
  await audit({ restaurantId, action: "waste.logged", summary: `${quantity} ${item.countUnit} ${item.name} — ${reason.replace("_", " ")}`, req: request });
  return NextResponse.json({ ok: true, valueCents: event.valueCents });
}
