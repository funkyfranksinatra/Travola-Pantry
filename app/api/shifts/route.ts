// app/api/shifts/route.ts — reading and writing the close-out.
//
// One row per service per day, enforced by a unique index rather than by
// hope. A second close-out for the same service is an EDIT (upsert), not
// an insert: the alternative is a duplicate that silently doubles a
// month's revenue and is nearly impossible to spot afterwards.
//
// Covers come pre-filled from the floor app's own reservations so the
// manager is confirming a number rather than looking one up. They can
// override it — walk-ins are real and the book does not know about them.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withTenant, requireRestaurant } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import {
  PERIODS,
  dateKey,
  likelyServiceDate,
  shiftTotals,
  validateShift,
  type Period,
} from "@/lib/shift";

export const dynamic = "force-dynamic";

/** Covers the floor app has on the book for a service date.
 *
 *  IMPORTANT: the floor app stores LOCAL wall-clock time in naive
 *  columns, so this compares dates directly and never applies a
 *  timezone. Converting here was the bug that once filed an entire
 *  restaurant's dinner service as brunch. */
async function bookedCovers(restaurantId: string, day: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ covers: bigint | null }>>(
    `SELECT COALESCE(SUM("partySize"), 0)::bigint AS covers
       FROM "Reservation"
      WHERE "restaurantId" = $1
        AND DATE(COALESCE("seatedTime", "targetTime")) = $2::date
        AND status <> 'CANCELLED'::"ReservationStatus"`,
    restaurantId,
    day,
  );
  return Number(rows[0]?.covers ?? 0);
}

function present(row: {
  id: string;
  serviceDate: Date;
  period: string;
  netSalesCents: number;
  foodSalesCents: number | null;
  bevSalesCents: number | null;
  compsCents: number;
  discountsCents: number;
  covers: number | null;
  laborMinutes: number | null;
  laborCostCents: number | null;
  source: string;
  notes: string | null;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceDate: dateKey(row.serviceDate),
    period: row.period,
    netSalesCents: row.netSalesCents,
    foodSalesCents: row.foodSalesCents,
    bevSalesCents: row.bevSalesCents,
    compsCents: row.compsCents,
    discountsCents: row.discountsCents,
    covers: row.covers,
    laborMinutes: row.laborMinutes,
    laborCostCents: row.laborCostCents,
    source: row.source,
    notes: row.notes,
    updatedAt: row.updatedAt,
    totals: shiftTotals(row),
  };
}

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const url = new URL(request.url);
    const wanted = url.searchParams.get("date");
    const listing = url.searchParams.get("list") === "1";

    if (listing) {
      const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit") ?? 60)));
      const rows = await prisma.shiftSalesEntry.findMany({
        where: { restaurantId },
        orderBy: [{ serviceDate: "desc" }, { period: "asc" }],
        take: limit,
      });
      return Response.json({ entries: rows.map(present) });
    }

    const day = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : likelyServiceDate(new Date());
    const [existing, booked, recent] = await Promise.all([
      prisma.shiftSalesEntry.findMany({
        where: { restaurantId, serviceDate: new Date(`${day}T00:00:00Z`) },
      }),
      bookedCovers(restaurantId, day),
      prisma.shiftSalesEntry.findMany({
        where: { restaurantId },
        orderBy: { serviceDate: "desc" },
        take: 14,
      }),
    ]);

    return Response.json({
      serviceDate: day,
      bookedCovers: booked,
      entries: existing.map(present),
      // The last fortnight, so Today can show a trend and — more
      // usefully — which nights have no close-out yet.
      recent: recent.map(present),
    });
  });
}

export async function POST(request: Request) {
  let restaurantId: string;
  try {
    restaurantId = requireRestaurant(request);
  } catch (error) {
    return error as Response;
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // The client parses money to integer cents before it gets here, but
  // the server never trusts that: everything is re-coerced and
  // re-validated. A client-side check is a courtesy, not a boundary.
  const draft = {
    serviceDate: String(body.serviceDate ?? ""),
    period: (String(body.period ?? "all_day") as Period),
    netSalesCents: body.netSalesCents == null ? null : Number(body.netSalesCents),
    foodSalesCents: body.foodSalesCents == null ? null : Number(body.foodSalesCents),
    bevSalesCents: body.bevSalesCents == null ? null : Number(body.bevSalesCents),
    compsCents: body.compsCents == null ? 0 : Number(body.compsCents),
    discountsCents: body.discountsCents == null ? 0 : Number(body.discountsCents),
    covers: body.covers == null ? null : Number(body.covers),
    laborMinutes: body.laborMinutes == null ? null : Number(body.laborMinutes),
    laborCostCents: body.laborCostCents == null ? null : Number(body.laborCostCents),
    notes: body.notes == null ? null : String(body.notes).trim() || null,
  };

  const problems = validateShift(draft);
  if (problems.length) {
    return NextResponse.json({ error: problems[0].message, fields: problems }, { status: 400 });
  }
  if (!PERIODS.includes(draft.period)) {
    return NextResponse.json({ error: "Pick a service." }, { status: 400 });
  }

  try {
    const serviceDate = new Date(`${draft.serviceDate}T00:00:00Z`);
    const data = {
      netSalesCents: draft.netSalesCents as number,
      foodSalesCents: draft.foodSalesCents,
      bevSalesCents: draft.bevSalesCents,
      compsCents: draft.compsCents,
      discountsCents: draft.discountsCents,
      covers: draft.covers,
      laborMinutes: draft.laborMinutes,
      laborCostCents: draft.laborCostCents,
      notes: draft.notes,
      source: "manual",
    };

    const existing = await prisma.shiftSalesEntry.findUnique({
      where: {
        restaurantId_serviceDate_period: {
          restaurantId,
          serviceDate,
          period: draft.period,
        },
      },
      select: { id: true, netSalesCents: true },
    });

    const saved = await prisma.shiftSalesEntry.upsert({
      where: {
        restaurantId_serviceDate_period: { restaurantId, serviceDate, period: draft.period },
      },
      create: { restaurantId, serviceDate, period: draft.period, ...data },
      update: data,
    });

    await audit({
      restaurantId,
      action: "shift.closed",
      summary: existing
        ? `Corrected the ${draft.period.replace("_", " ")} close-out for ${draft.serviceDate}`
        : `Closed out ${draft.period.replace("_", " ")} on ${draft.serviceDate}`,
      detail: existing ? { was: existing.netSalesCents, now: data.netSalesCents } : data,
      req: request,
    });

    return NextResponse.json({ ok: true, corrected: Boolean(existing), entry: present(saved) });
  } catch (error) {
    console.error("[shifts]", error);
    return NextResponse.json({ error: "Could not save that close-out." }, { status: 500 });
  }
}
