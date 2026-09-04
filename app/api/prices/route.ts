// app/api/prices/route.ts — the price verification report, one
// location's worth.
//
// R365's version compares 21 locations; with one location the same
// question is temporal instead of geographic: what did we pay, what
// did we pay LAST time, who sold it to us, and did the move break the
// category's cap or the contract. The receipts already hold every
// answer — this route only lines them up.
import { prisma } from "@/lib/prisma";
import { withTenant } from "@/lib/tenant";
import { DEFAULT_PRICE_CAP_PCT } from "@/lib/inventory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withTenant(request, async (restaurantId) => {
    const [items, caps, receipts] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { restaurantId, active: true },
        select: { id: true, name: true, category: true, purchaseUnit: true, contractPriceCents: true, preferredVendor: true },
      }),
      prisma.inventoryCategoryCap.findMany({ where: { restaurantId } }),
      // The last handful of receipts per item, newest first. Six is
      // enough to find the previous DISTINCT price behind a run of
      // same-price deliveries.
      prisma.$queryRawUnsafe<Array<{ itemId: string; unitCostCents: number; vendorName: string; receivedAt: Date; rn: unknown }>>(
        `SELECT * FROM (
           SELECT pl."itemId", pl."unitCostCents", p."vendorName", p."receivedAt",
                  ROW_NUMBER() OVER (PARTITION BY pl."itemId" ORDER BY p."receivedAt" DESC) AS rn
             FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
            WHERE p."restaurantId" = $1 AND p."receivedAt" IS NOT NULL
         ) ranked WHERE rn <= 6`,
        restaurantId,
      ),
    ]);
    const capByCategory = new Map(caps.map((cap) => [cap.category, Number(cap.capPct)]));
    const receiptsByItem = new Map<string, Array<{ unitCostCents: number; vendorName: string; receivedAt: Date }>>();
    for (const receipt of receipts) {
      const list = receiptsByItem.get(receipt.itemId) ?? [];
      list.push(receipt);
      receiptsByItem.set(receipt.itemId, list);
    }

    const rows = [];
    for (const item of items) {
      const history = (receiptsByItem.get(item.id) ?? []).sort(
        (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
      );
      if (!history.length) continue; // never received — nothing to verify
      const latest = history[0];
      const previous = history.find((receipt) => receipt.unitCostCents !== latest.unitCostCents) ?? null;
      const movePct = previous && previous.unitCostCents > 0
        ? ((latest.unitCostCents - previous.unitCostCents) / previous.unitCostCents) * 100
        : null;
      const capPct = capByCategory.get(item.category) ?? DEFAULT_PRICE_CAP_PCT;
      rows.push({
        itemId: item.id,
        name: item.name,
        category: item.category,
        purchaseUnit: item.purchaseUnit,
        vendorName: latest.vendorName,
        paidCents: latest.unitCostCents,
        paidAt: latest.receivedAt,
        previousCents: previous?.unitCostCents ?? null,
        movePct,
        capPct,
        overCap: movePct != null && Math.abs(movePct) >= capPct,
        contractPriceCents: item.contractPriceCents,
        overContract: item.contractPriceCents != null && item.contractPriceCents > 0 && latest.unitCostCents > item.contractPriceCents,
      });
    }

    // Trouble first: contract breaches, then cap breaks by size of
    // move, then everything else alphabetically — the report is a
    // phone-call list, and the first row is the first call.
    rows.sort((a, b) =>
      Number(b.overContract) - Number(a.overContract) ||
      Number(b.overCap) - Number(a.overCap) ||
      Math.abs(b.movePct ?? 0) - Math.abs(a.movePct ?? 0) ||
      a.name.localeCompare(b.name));

    return Response.json({ rows });
  });
}
