// lib/variance-engine.ts — the AvT computation, shared.
//
// Extracted from the variance route the day the weekly email digest
// arrived, for one reason: the report on the screen and the report in
// the inbox must be THE SAME numbers from the same arithmetic. Two
// implementations of "food cost this window" is how the two start
// arguing, and the argument is always discovered by a customer.
//
//   actual      = opening + received − closing        (count units)
//   theoretical = Σ recipe lines × items sold          (usage → count)
//   variance    = actual − theoretical − logged waste
//
// The window is bounded by two APPROVED counts — never drafts, never
// submissions, because a variance built on an unapproved count is an
// accusation built on a number nobody has vouched for.
import { prisma } from "./prisma";
import { salesCentsBetween } from "./sales";
import { costPerCountCents, varianceForItem, type VarianceRow } from "./inventory";

export type VarianceReportRow = VarianceRow & {
  roomName: string; countUnit: string; category: string;
  hasRecipeUsage: boolean; wasteValueCents: number;
  theoreticalValueCents: number | null;
  sharePct: number | null;
};

export type VarianceReport =
  | { ready: false; reason: string; counts: AvailableCount[] }
  | {
      ready: true;
      window: { from: Date; to: Date; openId: string; closeId: string };
      counts: AvailableCount[];
      hasSalesData: boolean;
      salesNote?: string;
      totals: {
        openingValueCents: number; closingValueCents: number;
        varianceValueCents: number; actualUsageValueCents: number;
        wasteValueCents: number; salesCents: number; cogsPct: number | null;
      };
      rows: VarianceReportRow[];
    };

type AvailableCount = {
  id: string; approvedAt: Date | null; type: string;
  countedBy: string; totalValueCents: number; lineCount: number;
};

async function resolveWindow(restaurantId: string, openIdParam?: string | null, closeIdParam?: string | null) {
  const approved = await prisma.inventoryCount.findMany({
    where: { restaurantId, status: "approved" },
    orderBy: { approvedAt: "desc" },
    take: 12,
    select: { id: true, approvedAt: true, type: true, countedBy: true, totalValueCents: true, _count: { select: { lines: true } } },
  });
  const availableCounts: AvailableCount[] = approved.map((count) => ({
    id: count.id, approvedAt: count.approvedAt, type: count.type,
    countedBy: count.countedBy, totalValueCents: count.totalValueCents, lineCount: count._count.lines,
  }));
  const openId = openIdParam ?? approved[1]?.id ?? null;
  const closeId = closeIdParam ?? approved[0]?.id ?? null;
  return { approved, availableCounts, openId, closeId };
}

export async function varianceReport(
  restaurantId: string,
  openIdParam?: string | null,
  closeIdParam?: string | null,
): Promise<VarianceReport | { error: string; status: number }> {
  const { approved, availableCounts, openId, closeId } = await resolveWindow(restaurantId, openIdParam, closeIdParam);

  if (!openId || !closeId || openId === closeId) {
    return {
      ready: false,
      reason: approved.length < 2
        ? "Variance needs two approved counts to bracket a window. Approve a second count and this fills in."
        : "Pick two different counts.",
      counts: availableCounts,
    };
  }

  const [opening, closing] = await Promise.all([
    prisma.inventoryCount.findFirst({ where: { id: openId, restaurantId, status: "approved" }, include: { lines: true } }),
    prisma.inventoryCount.findFirst({ where: { id: closeId, restaurantId, status: "approved" }, include: { lines: true } }),
  ]);
  if (!opening?.approvedAt || !closing?.approvedAt) {
    return { error: "Both counts must exist and be approved.", status: 400 };
  }
  // The engine does not care which the user clicked first.
  const [from, to] = opening.approvedAt <= closing.approvedAt ? [opening, closing] : [closing, opening];
  const fromAt = from.approvedAt as Date;
  const toAt = to.approvedAt as Date;

  const items = await prisma.inventoryItem.findMany({ where: { restaurantId, active: true }, include: { room: { select: { name: true } } } });

  // Purchases received inside the window, per item — quantities for
  // the per-item equation, and each line's ACTUAL receipt cost for the
  // headline. The receipt cost matters: pricing the headline at today's
  // cost would quietly rewrite last month's food cost every time a
  // price ripples.
  const received = await prisma.$queryRawUnsafe<Array<{ itemId: string; qty: unknown; cents: unknown }>>(
    `SELECT pl."itemId", SUM(COALESCE(pl."qtyReceived", pl."qtyOrdered")) AS qty,
            SUM(ROUND(COALESCE(pl."qtyReceived", pl."qtyOrdered") * pl."unitCostCents")) AS cents
       FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
      WHERE p."restaurantId" = $1 AND p."receivedAt" IS NOT NULL
        AND p."receivedAt" >= $2 AND p."receivedAt" <= $3
      GROUP BY pl."itemId"`,
    restaurantId, fromAt, toAt,
  );

  // Waste logged inside the window, per item, in count units.
  const waste = await prisma.$queryRawUnsafe<Array<{ itemId: string; qty: unknown }>>(
    `SELECT "itemId", SUM(quantity) AS qty FROM "WasteEvent"
      WHERE "restaurantId" = $1 AND "occurredAt" >= $2 AND "occurredAt" <= $3
      GROUP BY "itemId"`,
    restaurantId, fromAt, toAt,
  );

  // Theoretical usage: recipe lines × closed-check item quantities in
  // the window. POS timestamps are real UTC; the window bounds are
  // also real timestamps, so this comparison needs no timezone game.
  const theoretical = await prisma.$queryRawUnsafe<Array<{ itemId: string; qty: unknown; sold: unknown }>>(
    `SELECT rl."itemId", SUM(rl.quantity * ci.quantity) AS qty, SUM(ci.quantity) AS sold
       FROM "CheckItem" ci
       JOIN "Check" ch ON ch.id = ci."checkId"
       JOIN "Recipe" r ON r."menuItemId" = ci."menuItemId" AND r."restaurantId" = $1
       JOIN "RecipeLine" rl ON rl."recipeId" = r.id
      WHERE ch."restaurantId" = $1 AND ch.status = 'closed'
        AND ch."openedAt" >= $2 AND ch."openedAt" <= $3
      GROUP BY rl."itemId"`,
    restaurantId, fromAt, toAt,
  );

  const hasSales = await prisma.check.count({
    where: { restaurantId, status: "closed", openedAt: { gte: fromAt, lte: toAt } },
  });

  // Which items appear in ANY recipe. For an item no recipe references
  // (fryer oil, cleaning supplies), theoretical usage is UNKNOWABLE —
  // not zero. Zero would file its entire actual usage as variance,
  // which reads as an accusation about an item the maths cannot see.
  const inAnyRecipe = new Set(
    (await prisma.recipeLine.findMany({
      where: { recipe: { restaurantId } },
      select: { itemId: true },
      distinct: ["itemId"],
    })).map((row) => row.itemId),
  );

  const openQty = new Map(from.lines.map((line) => [line.itemId, Number(line.quantity)]));
  const closeQty = new Map(to.lines.map((line) => [line.itemId, Number(line.quantity)]));
  const receivedQty = new Map(received.map((row) => [row.itemId, Number(row.qty)]));
  const wasteQty = new Map(waste.map((row) => [row.itemId, Number(row.qty)]));
  const theoQty = new Map(theoretical.map((row) => [row.itemId, Number(row.qty)]));

  const rows: Array<Omit<VarianceReportRow, "sharePct">> = [];
  for (const item of items) {
    const spec = { countPerPurchase: Number(item.countPerPurchase), usagePerCount: Number(item.usagePerCount), lastCostCents: item.lastCostCents };
    const inOpen = openQty.has(item.id);
    const inClose = closeQty.has(item.id);
    // Items in neither count contribute nothing but noise.
    if (!inOpen && !inClose && !receivedQty.has(item.id)) continue;
    const wasteCount = wasteQty.get(item.id) ?? 0;
    const computed = varianceForItem({
      itemId: item.id, itemName: item.name, spec,
      openingQty: inOpen ? openQty.get(item.id)! : null,
      closingQty: inClose ? closeQty.get(item.id)! : null,
      receivedPurchaseQty: receivedQty.get(item.id) ?? 0,
      wasteQty: wasteCount,
      // Three honest states: with sales data and a recipe that uses
      // this item, theoretical is real (a genuine zero when none of
      // its dishes sold). In no recipe at all, or with no sales
      // data, it is UNKNOWABLE and stays null rather than filing
      // the item's entire usage as variance.
      theoreticalUsageQty:
        hasSales > 0 && inAnyRecipe.has(item.id) ? theoQty.get(item.id) ?? 0 : null,
    });
    rows.push({
      ...computed,
      roomName: item.room.name,
      countUnit: item.countUnit,
      category: item.category,
      hasRecipeUsage: theoQty.has(item.id),
      // Waste priced at today's cost: what those logged pounds and
      // bottles were worth — the explained slice of the variance.
      wasteValueCents: Math.round(wasteCount * costPerCountCents(spec)),
      // The dollars view of the same row: what the recipes say should
      // have left the building, at cost.
      theoreticalValueCents: computed.theoreticalUsageCount != null
        ? Math.round(computed.theoreticalUsageCount * costPerCountCents(spec))
        : null,
    });
  }

  // Worst variance by dollar first — the report is a hunting list.
  rows.sort((a, b) => Math.abs(b.varianceValueCents ?? 0) - Math.abs(a.varianceValueCents ?? 0));

  // The headline food cost is the LEDGER equation on frozen numbers:
  // opening valuation + deliveries at their receipt prices − closing
  // valuation. Frozen, because an approved count is a historical
  // document — repricing oil today must not rewrite last month's food
  // cost. (The per-row dollar values below stay priced at today's cost
  // on purpose: they are a hunting list for what to fix NOW, not a
  // ledger.) The Today tab's trend uses this same equation, so the two
  // screens cannot disagree about a window.
  const receivedValueCents = received.reduce((sum, row) => sum + Number(row.cents), 0);
  const actualUsageValueCents = from.totalValueCents + receivedValueCents - to.totalValueCents;

  // The cost breakout: each item's share of the rows' usage dollars.
  // This is what tells a lobster house to watch the lobster — effort
  // goes where the money is, not where the list is longest.
  const rowsUsageValueCents = rows.reduce((sum, row) => sum + Math.max(0, row.actualValueCents ?? 0), 0);
  const sharedRows: VarianceReportRow[] = rows.map((row) => ({
    ...row,
    sharePct: rowsUsageValueCents > 0 && row.actualValueCents != null && row.actualValueCents > 0
      ? (row.actualValueCents / rowsUsageValueCents) * 100
      : null,
  }));

  // The headline denominator: net sales inside the window, checks
  // first with typed close-outs filling check-less days. Food cost
  // as a % of sales is the number every operator manages to.
  const salesCents = await salesCentsBetween(restaurantId, fromAt, toAt);

  return {
    ready: true,
    window: { from: fromAt, to: toAt, openId: from.id, closeId: to.id },
    counts: availableCounts,
    hasSalesData: hasSales > 0,
    salesNote: hasSales > 0
      ? undefined
      : "No item-level sales in this window, so theoretical usage is unknown. Actual usage still shows. Sales arrive with a POS integration.",
    totals: {
      openingValueCents: from.totalValueCents,
      closingValueCents: to.totalValueCents,
      varianceValueCents: rows.reduce((sum, row) => sum + (row.varianceValueCents ?? 0), 0),
      actualUsageValueCents,
      wasteValueCents: rows.reduce((sum, row) => sum + row.wasteValueCents, 0),
      salesCents,
      // Null when the window has no sales — a 0% food cost is a lie.
      cogsPct: salesCents > 0 ? (actualUsageValueCents / salesCents) * 100 : null,
    },
    rows: sharedRows,
  };
}

/** One item's full equation: the counts that bookend it, every
 *  delivery, the waste log, and dish-by-dish sales. R365 calls this
 *  drill-through; here nobody leaves the page. */
export async function varianceDrill(
  restaurantId: string,
  openIdParam: string | null,
  closeIdParam: string | null,
  itemId: string,
): Promise<{ drill: unknown } | { error: string; status: number }> {
  const { openId, closeId } = await resolveWindow(restaurantId, openIdParam, closeIdParam);
  if (!openId || !closeId || openId === closeId) return { error: "No window.", status: 400 };
  const [opening, closing] = await Promise.all([
    prisma.inventoryCount.findFirst({ where: { id: openId, restaurantId, status: "approved" }, include: { lines: true } }),
    prisma.inventoryCount.findFirst({ where: { id: closeId, restaurantId, status: "approved" }, include: { lines: true } }),
  ]);
  if (!opening?.approvedAt || !closing?.approvedAt) return { error: "Both counts must exist and be approved.", status: 400 };
  const [from, to] = opening.approvedAt <= closing.approvedAt ? [opening, closing] : [closing, opening];
  const fromAt = from.approvedAt as Date;
  const toAt = to.approvedAt as Date;

  const item = await prisma.inventoryItem.findFirst({ where: { id: itemId, restaurantId } });
  if (!item) return { error: "Item not found.", status: 404 };

  const [purchaseRows, wasteRows, dishRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ id: string; vendorName: string; receivedAt: Date; qty: unknown; unitCostCents: number }>>(
      `SELECT p.id, p."vendorName", p."receivedAt", COALESCE(pl."qtyReceived", pl."qtyOrdered") AS qty, pl."unitCostCents"
         FROM "PurchaseLine" pl JOIN "Purchase" p ON p.id = pl."purchaseId"
        WHERE p."restaurantId" = $1 AND pl."itemId" = $2 AND p."receivedAt" IS NOT NULL
          AND p."receivedAt" >= $3 AND p."receivedAt" <= $4
        ORDER BY p."receivedAt"`,
      restaurantId, itemId, fromAt, toAt,
    ),
    prisma.wasteEvent.findMany({
      where: { restaurantId, itemId, occurredAt: { gte: fromAt, lte: toAt } },
      orderBy: { occurredAt: "asc" },
      select: { quantity: true, reason: true, valueCents: true, note: true, recordedBy: true, occurredAt: true },
    }),
    prisma.$queryRawUnsafe<Array<{ dishName: string; sold: unknown; perUnit: unknown; usage: unknown }>>(
      `SELECT mi.name AS "dishName", SUM(ci.quantity) AS sold, rl.quantity AS "perUnit", SUM(rl.quantity * ci.quantity) AS usage
         FROM "CheckItem" ci
         JOIN "Check" ch ON ch.id = ci."checkId"
         JOIN "Recipe" r ON r."menuItemId" = ci."menuItemId" AND r."restaurantId" = $1
         JOIN "RecipeLine" rl ON rl."recipeId" = r.id AND rl."itemId" = $2
         JOIN "MenuItem" mi ON mi.id = ci."menuItemId"
        WHERE ch."restaurantId" = $1 AND ch.status = 'closed'
          AND ch."openedAt" >= $3 AND ch."openedAt" <= $4
        GROUP BY mi.name, rl.quantity
        ORDER BY usage DESC`,
      restaurantId, itemId, fromAt, toAt,
    ),
  ]);
  const openLine = from.lines.find((line) => line.itemId === itemId);
  const closeLine = to.lines.find((line) => line.itemId === itemId);
  return {
    drill: {
      itemId: item.id, itemName: item.name, countUnit: item.countUnit,
      usageUnit: item.usageUnit, purchaseUnit: item.purchaseUnit,
      opening: openLine ? { quantity: Number(openLine.quantity), at: fromAt, valueCents: openLine.valueCents } : null,
      closing: closeLine ? { quantity: Number(closeLine.quantity), at: toAt, valueCents: closeLine.valueCents } : null,
      purchases: purchaseRows.map((row) => ({
        purchaseId: row.id, vendorName: row.vendorName, receivedAt: row.receivedAt,
        qty: Number(row.qty), unitCostCents: row.unitCostCents,
      })),
      waste: wasteRows.map((row) => ({
        quantity: Number(row.quantity), reason: row.reason, valueCents: row.valueCents,
        note: row.note, recordedBy: row.recordedBy, occurredAt: row.occurredAt,
      })),
      dishes: dishRows.map((row) => ({
        dishName: row.dishName, sold: Number(row.sold), perUnit: Number(row.perUnit), usage: Number(row.usage),
      })),
    },
  };
}
