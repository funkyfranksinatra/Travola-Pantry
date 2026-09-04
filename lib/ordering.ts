// lib/ordering.ts — theoretical on-hand and the suggested order.
//
// The maths R365 made the industry standard, kept pure and unit-tested:
//
//   usage per $1,000  = actual usage in a counted window ÷ that window's
//                       sales, in thousands. Normalising by SALES rather
//                       than days is the trick — the rate self-adjusts
//                       for a slow Tuesday vs a slammed Saturday.
//   theoretical       = last approved count + received since
//   on-hand             − (usage rate × sales since the count)
//                       …"what should be on my shelf right now",
//                       without walking to the shelf.
//   suggestion        = expected usage across the order's horizon
//                       − theoretical on-hand, rounded UP to whole
//                       purchase units.
//
// Null-honesty holds throughout: an item with no counted window, or a
// window with no sales, has NO usage rate — and a suggestion built on a
// guessed rate is an over-order (or a Saturday-night 86) wearing a
// confident number. Every null carries a reason the UI can print.
//
// Everything here is pure; the route feeds it and the tests hammer it.

import { purchaseToCount, type UnitSpec } from "./inventory";

export type UsageRateInput = {
  /// Actual usage across the last complete counted window, COUNT units.
  /// Null when the item missed either bookend count.
  windowUsageCount: number | null;
  /// Net sales in that window, cents. The denominator.
  windowSalesCents: number;
};

/** Count units used per $1,000 of net sales. Null (with a reason) when
 *  the window cannot support a rate. */
export function usagePer1000(input: UsageRateInput): { rate: number | null; reason?: string } {
  if (input.windowUsageCount == null) {
    return { rate: null, reason: "not in both bookend counts" };
  }
  if (input.windowSalesCents <= 0) {
    return { rate: null, reason: "no sales in the counted window" };
  }
  // Negative usage means the closing count found MORE than opening +
  // received — a miscount somewhere. A negative rate would "suggest"
  // negative orders forever after; clamp to zero and let the variance
  // report tell the real story.
  const rate = Math.max(0, input.windowUsageCount) / (input.windowSalesCents / 100_000);
  return { rate };
}

export type OnHandInput = {
  /// Quantity at the item's most recent approved count, COUNT units.
  lastCountQty: number | null;
  /// Purchase units received AFTER that count.
  receivedPurchaseQtySince: number;
  /// Net sales cents since that count.
  salesCentsSince: number;
  /// Count units per $1,000 of sales (from usagePer1000).
  ratePer1000: number | null;
  spec: UnitSpec;
};

/** What should be on the shelf right now, in count units. Never below
 *  zero — a negative shelf is a rate error, not a prediction. */
export function theoreticalOnHand(input: OnHandInput): { onHand: number | null; reason?: string } {
  if (input.lastCountQty == null) return { onHand: null, reason: "no approved count includes this item" };
  if (input.ratePer1000 == null) return { onHand: null, reason: "no usage rate yet" };
  const received = purchaseToCount(input.spec, input.receivedPurchaseQtySince);
  const depleted = input.ratePer1000 * (input.salesCentsSince / 100_000);
  return { onHand: Math.max(0, input.lastCountQty + received - depleted) };
}

export type SuggestionInput = {
  onHandCount: number | null;
  ratePer1000: number | null;
  /// Expected net sales cents across the order's horizon — the days the
  /// delivery must cover (consumption days + buffer days, where buffer
  /// is thaw/prep time the product sits unused; it extends how long the
  /// shelf must last, so it belongs in the horizon).
  horizonSalesCents: number;
  spec: UnitSpec;
};

/** How much to order: expected usage minus what should already be
 *  there, rounded UP to whole purchase units. Rounding up is deliberate
 *  — vendors sell whole cases, and rounding down converts every
 *  fractional need into a Saturday-night 86. */
export function suggestOrder(input: SuggestionInput): {
  neededCount: number;
  purchaseQty: number;
} | null {
  if (input.onHandCount == null || input.ratePer1000 == null) return null;
  if (input.spec.countPerPurchase <= 0) return null;
  const expectedUsage = input.ratePer1000 * (input.horizonSalesCents / 100_000);
  const needed = Math.max(0, expectedUsage - input.onHandCount);
  // A sliver of need (under a tenth of a purchase unit) is noise from
  // the rate, not a case worth ordering.
  const purchaseQty = needed / input.spec.countPerPurchase < 0.1 ? 0 : Math.ceil(needed / input.spec.countPerPurchase);
  return { neededCount: needed, purchaseQty };
}

/** Trailing average daily sales × horizon days. The forecast seam:
 *  when the floor app's VolumePredictor grows a sales forecast this is
 *  the one function it replaces. */
export function forecastSalesCents(trailingSalesCents: number, trailingDays: number, horizonDays: number): number {
  if (trailingDays <= 0 || horizonDays <= 0) return 0;
  return Math.round((trailingSalesCents / trailingDays) * horizonDays);
}
