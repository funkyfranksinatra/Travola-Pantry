// lib/sales.ts — net sales for a time window, from two sources honestly.
//
// POS checks carry sales where the POS wrote them; typed close-outs
// (ShiftSalesEntry) carry the nights before the POS existed — or the
// nights it was down. The rule, identical to Travola Home's analytics:
// a service day with closed checks is counted from CHECKS ONLY, and a
// typed close-out fills a day only when no checks exist for it. Summing
// both for one night would double every dollar.
import { prisma } from "./prisma";

/** Net sales cents in [from, to]: check subtotals (pre-tax, pre-tip)
 *  plus typed close-outs for check-less days. */
export async function salesCentsBetween(restaurantId: string, from: Date, to: Date): Promise<number> {
  const [checks] = await prisma.$queryRawUnsafe<Array<{ total: unknown }>>(
    `SELECT COALESCE(SUM(ch."subtotalCents"), 0) AS total
       FROM "Check" ch
      WHERE ch."restaurantId" = $1 AND ch.status = 'closed'
        AND ch."openedAt" >= $2 AND ch."openedAt" <= $3`,
    restaurantId, from, to,
  );
  const [typed] = await prisma.$queryRawUnsafe<Array<{ total: unknown }>>(
    `SELECT COALESCE(SUM(s."netSalesCents"), 0) AS total
       FROM "ShiftSalesEntry" s
      WHERE s."restaurantId" = $1
        AND s."serviceDate" >= $2::date AND s."serviceDate" <= $3::date
        AND NOT EXISTS (
          SELECT 1 FROM "Check" c2
           WHERE c2."restaurantId" = $1 AND c2.status = 'closed'
             AND c2."openedAt"::date = s."serviceDate"
        )`,
    restaurantId, from, to,
  );
  return Number(checks?.total ?? 0) + Number(typed?.total ?? 0);
}
