// app/api/trend/route.ts — food cost, window to window.
//
// The weekly-P&L habit at Pantry's scale: one point per counted window
// (consecutive approved counts), each point the total-level COGS
// equation —
//
//   usage $ = opening valuation + deliveries received − closing valuation
//   food cost % = usage $ ÷ net sales in the window
//
// Total-level on purpose: the frozen count valuations and received
// lines make this exact without recomputing the per-item engine twelve
// times, and it can never disagree with the variance report's window
// because both start from the same frozen totals.
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { salesCentsBetween } from "@/lib/sales";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const counts = await prisma.inventoryCount.findMany({
      where: { restaurantId, status: "approved", approvedAt: { not: null } },
      orderBy: { approvedAt: "asc" },
      take: 13, // 12 windows — a quarter of weekly counting
      select: { id: true, approvedAt: true, totalValueCents: true },
    });
    if (counts.length < 2) {
      return Response.json({ points: [], reason: "Two approved counts make the first point; each count after that adds one." });
    }

    // All received lines across the whole span, bucketed per window in
    // JS — one query instead of one per window.
    const firstAt = counts[0].approvedAt as Date;
    const lastAt = counts[counts.length - 1].approvedAt as Date;
    const receivedRows = await prisma.$queryRawUnsafe<Array<{ receivedAt: Date; cents: unknown }>>(
      `SELECT p."receivedAt", SUM(ROUND(COALESCE(pl."qtyReceived", pl."qtyOrdered") * pl."unitCostCents")) AS cents
         FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
        WHERE p."restaurantId" = $1 AND p."receivedAt" IS NOT NULL
          AND p."receivedAt" >= $2 AND p."receivedAt" <= $3
        GROUP BY p."receivedAt"`,
      restaurantId, firstAt, lastAt,
    );

    const points = [];
    for (let i = 1; i < counts.length; i += 1) {
      const opening = counts[i - 1];
      const closing = counts[i];
      const fromAt = opening.approvedAt as Date;
      const toAt = closing.approvedAt as Date;
      const receivedCents = receivedRows
        .filter((row) => row.receivedAt > fromAt && row.receivedAt <= toAt)
        .reduce((sum, row) => sum + Number(row.cents), 0);
      const usageValueCents = opening.totalValueCents + receivedCents - closing.totalValueCents;
      const salesCents = await salesCentsBetween(restaurantId, fromAt, toAt);
      points.push({
        key: closing.id,
        from: fromAt,
        to: toAt,
        usageValueCents,
        receivedCents,
        salesCents,
        // Null when the window has no sales — a 0% food cost is a lie,
        // and a chart that draws it teaches people to distrust the chart.
        cogsPct: salesCents > 0 ? (usageValueCents / salesCents) * 100 : null,
      });
    }

    return Response.json({ points });
  });
}
