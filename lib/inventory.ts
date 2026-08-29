// lib/inventory.ts — the unit maths, valuation, and the AvT engine.
//
// Everything here is pure. The three-unit problem (purchase / count /
// usage) is the thing that sinks inventory projects, so the conversions
// live in exactly one place, are unit-tested, and every caller goes
// through them. Nobody re-derives "how many oz in a case" in a route
// handler at midnight.
//
// Money stays in integer cents; quantities are decimal (a real count is
// "2 cases and 3 lb"). The one rounding rule: round at the VALUE step,
// once, never on intermediate quantities.

export const ROOM_KINDS = ["walkin", "freezer", "dry", "bar", "cellar", "prep", "other"] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const ROOM_KIND_LABELS: Record<RoomKind, string> = {
  walkin: "Walk-in cooler",
  freezer: "Freezer",
  dry: "Dry storage",
  bar: "Bar",
  cellar: "Cellar",
  prep: "Prep",
  other: "Other",
};

export const ITEM_KINDS = ["food", "beverage", "nonfood"] as const;
export const WASTE_REASONS = ["spoilage", "prep_error", "breakage", "comp", "staff_meal", "other"] as const;

export type UnitSpec = {
  countPerPurchase: number; // count units in one purchase unit
  usagePerCount: number;    // usage units in one count unit
  lastCostCents: number;    // cents per PURCHASE unit
};

// ── Conversions ──────────────────────────────────────────────────
// Cost flows downhill from the invoice: purchase → count → usage.
// This is the whole of "cost rippling" — because every recipe cost is
// DERIVED from lastCostCents at read time, receiving one repriced case
// of oil reprices every dish that uses oil with no propagation job, no
// event, no stale cache to invalidate.

export function costPerCountCents(spec: UnitSpec): number {
  if (spec.countPerPurchase <= 0) return 0;
  return spec.lastCostCents / spec.countPerPurchase;
}

export function costPerUsageCents(spec: UnitSpec): number {
  if (spec.usagePerCount <= 0) return 0;
  return costPerCountCents(spec) / spec.usagePerCount;
}

export function purchaseToCount(spec: UnitSpec, purchaseQty: number): number {
  return purchaseQty * spec.countPerPurchase;
}

export function usageToCount(spec: UnitSpec, usageQty: number): number {
  if (spec.usagePerCount <= 0) return 0;
  return usageQty / spec.usagePerCount;
}

/** Value of a counted quantity, rounded ONCE, here. */
export function lineValueCents(spec: UnitSpec, countQty: number): number {
  return Math.round(countQty * costPerCountCents(spec));
}

// ── Validation ───────────────────────────────────────────────────

export type FieldError = { field: string; message: string };

export function validateItem(input: {
  name?: unknown;
  countPerPurchase?: unknown;
  usagePerCount?: unknown;
  lastCostCents?: unknown;
  parLevel?: unknown;
}): FieldError[] {
  const errors: FieldError[] = [];
  const name = String(input.name ?? "").trim();
  if (!name) errors.push({ field: "name", message: "The item needs a name." });
  if (name.length > 80) errors.push({ field: "name", message: "Keep the name under 80 characters." });

  for (const [field, label] of [
    ["countPerPurchase", "Count units per purchase unit"],
    ["usagePerCount", "Usage units per count unit"],
  ] as const) {
    if (input[field] === undefined) continue;
    const value = Number(input[field]);
    // Zero is the poison value: it silently turns every cost derived
    // from this item into zero, which reads as "free" on a report.
    if (!Number.isFinite(value) || value <= 0) {
      errors.push({ field, message: `${label} must be a positive number.` });
    } else if (value > 100000) {
      errors.push({ field, message: `${label} looks wrong — check the units.` });
    }
  }
  if (input.lastCostCents !== undefined) {
    const value = Number(input.lastCostCents);
    if (!Number.isFinite(value) || value < 0) {
      errors.push({ field: "lastCostCents", message: "Cost cannot be negative." });
    }
  }
  if (input.parLevel !== undefined && input.parLevel !== null && input.parLevel !== "") {
    const value = Number(input.parLevel);
    if (!Number.isFinite(value) || value < 0) {
      errors.push({ field: "parLevel", message: "Par must be zero or more." });
    }
  }
  return errors;
}

export function validateQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return n;
}

/** The outlier guard: is this count wildly unlike the last approved
 *  one? One fat-fingered 40-for-4 poisons a month of food cost, and
 *  the person who typed it will never know unless the keystroke is
 *  challenged. Flags 8× in either direction once the numbers are big
 *  enough to matter — 0→2 bottles is restocking, not a typo. */
export function isOutlier(current: number, previous: number | null | undefined): boolean {
  if (previous == null || previous <= 0) return false;
  if (current < 4 && previous < 4) return false;
  // Two thresholds: small numbers need an 8× swing before they are
  // suspicious (0→2 bottles is restocking), but once either side is
  // 20+, a 4× swing is almost always a slipped digit — 400 typed for
  // 40 lands at 5× of an 80-lb previous count and must be caught.
  const big = current >= 20 || previous >= 20;
  const ratio = big ? 4 : 8;
  return current >= previous * ratio || (current > 0 && current <= previous / ratio) || (current === 0 && previous >= 8);
}

// ── The AvT engine ───────────────────────────────────────────────
// Actual usage comes from the count equation; theoretical from recipes
// × units sold. The gap is the single most valuable number an inventory
// system produces: it is over-portioning, waste, breakage and theft,
// visible tonight instead of in a month-end P&L.
//
// Everything is normalised to COUNT units before comparing, because
// counts are the ground truth and their unit is the one a human can
// re-verify by walking to the shelf.

export type VarianceInput = {
  itemId: string;
  itemName: string;
  spec: UnitSpec;
  openingQty: number | null;   // count units, from the opening count
  closingQty: number | null;   // count units, from the closing count
  receivedPurchaseQty: number; // purchase units received in the window
  wasteQty: number;            // count units logged as waste
  theoreticalUsageQty: number | null; // usage units from recipes × sales; null when no recipe or no sales data
};

export type VarianceRow = {
  itemId: string;
  itemName: string;
  actualUsageCount: number | null;
  theoreticalUsageCount: number | null;
  wasteCount: number;
  /** actual − theoretical − waste, in count units. Positive = more left
   *  the building than sales and logged waste explain. */
  varianceCount: number | null;
  varianceValueCents: number | null;
  actualValueCents: number | null;
};

export function varianceForItem(input: VarianceInput): VarianceRow {
  const { spec } = input;
  // Without both bookend counts there is no actual usage — say null,
  // never guess. A variance built on a guessed opening balance is an
  // accusation built on nothing.
  const actual =
    input.openingQty != null && input.closingQty != null
      ? input.openingQty + purchaseToCount(spec, input.receivedPurchaseQty) - input.closingQty
      : null;

  const theoretical =
    input.theoreticalUsageQty != null ? usageToCount(spec, input.theoreticalUsageQty) : null;

  const variance =
    actual != null && theoretical != null ? actual - theoretical - input.wasteQty : null;

  return {
    itemId: input.itemId,
    itemName: input.itemName,
    actualUsageCount: actual,
    theoreticalUsageCount: theoretical,
    wasteCount: input.wasteQty,
    varianceCount: variance,
    varianceValueCents: variance != null ? Math.round(variance * costPerCountCents(spec)) : null,
    actualValueCents: actual != null ? Math.round(actual * costPerCountCents(spec)) : null,
  };
}

// ── Recipe costing ───────────────────────────────────────────────

export type RecipeLineCost = {
  itemName: string;
  quantity: number; // usage units
  usageUnit: string;
  costCents: number;
};

/** Plate cost = Σ line quantity × cost per usage unit. Computed at
 *  read, never stored — that is what makes a price change ripple. */
export function plateCostCents(
  lines: Array<{ quantity: number; spec: UnitSpec }>,
): number {
  return Math.round(
    lines.reduce((sum, line) => sum + line.quantity * costPerUsageCents(line.spec), 0),
  );
}

/** Margin line for a recipe against its menu price. Zero-priced items
 *  never claim a margin. */
export function plateMarginPct(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return ((priceCents - costCents) / priceCents) * 100;
}

// ── Three-way match ──────────────────────────────────────────────
// PO vs truck vs invoice. The three disagree constantly; the job is to
// surface the disagreement, not to average it away.

export type MatchProblem =
  | { kind: "short"; itemName: string; ordered: number; received: number }
  | { kind: "over"; itemName: string; ordered: number; received: number }
  | { kind: "price_changed"; itemName: string; wasCents: number; nowCents: number; pct: number }
  | { kind: "invoice_mismatch"; invoiceCents: number; receivedCents: number };

export function threeWayMatch(purchase: {
  invoiceTotalCents: number | null;
  lines: Array<{
    itemName: string;
    qtyOrdered: number;
    qtyReceived: number | null;
    unitCostCents: number;
    previousCostCents: number;
  }>;
}): { problems: MatchProblem[]; receivedTotalCents: number } {
  const problems: MatchProblem[] = [];
  let receivedTotal = 0;

  for (const line of purchase.lines) {
    const received = line.qtyReceived ?? line.qtyOrdered;
    receivedTotal += Math.round(received * line.unitCostCents);

    if (line.qtyReceived != null && line.qtyReceived < line.qtyOrdered) {
      problems.push({ kind: "short", itemName: line.itemName, ordered: line.qtyOrdered, received: line.qtyReceived });
    }
    if (line.qtyReceived != null && line.qtyReceived > line.qtyOrdered) {
      problems.push({ kind: "over", itemName: line.itemName, ordered: line.qtyOrdered, received: line.qtyReceived });
    }
    if (line.previousCostCents > 0 && line.unitCostCents !== line.previousCostCents) {
      const pct = ((line.unitCostCents - line.previousCostCents) / line.previousCostCents) * 100;
      // A cent of drift is rounding; 2% is a price change worth a look.
      if (Math.abs(pct) >= 2) {
        problems.push({
          kind: "price_changed",
          itemName: line.itemName,
          wasCents: line.previousCostCents,
          nowCents: line.unitCostCents,
          pct,
        });
      }
    }
  }

  if (purchase.invoiceTotalCents != null) {
    // A dollar of slack: freight rounding and tax quirks are real, and
    // blocking reconciliation over 40 cents teaches people to stop
    // filling the invoice field in at all.
    if (Math.abs(purchase.invoiceTotalCents - receivedTotal) > 100) {
      problems.push({
        kind: "invoice_mismatch",
        invoiceCents: purchase.invoiceTotalCents,
        receivedCents: receivedTotal,
      });
    }
  }

  return { problems, receivedTotalCents: receivedTotal };
}
