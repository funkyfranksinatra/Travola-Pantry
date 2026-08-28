// lib/shift.ts — the close-out, as rules rather than as a form.
//
// Everything here is pure. The validation below is what an owner runs
// into at 1am with a printout in one hand, so it has to be forgiving
// about FORMAT ("$1,240.50", "1240.5", "1,240") and unforgiving about
// SENSE (beverage sales larger than total sales is a typo, not a night).
//
// The money rule for the whole app: parse to integer cents at the edge,
// never carry a float. A cent lost to floating point in a sales figure
// becomes a wrong food-cost percentage three screens later, and nobody
// ever traces it back.

export const PERIODS = ["all_day", "lunch", "dinner"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  all_day: "All day",
  lunch: "Lunch",
  dinner: "Dinner",
};

export type ShiftDraft = {
  serviceDate: string; // YYYY-MM-DD
  period: Period;
  netSalesCents: number | null;
  foodSalesCents: number | null;
  bevSalesCents: number | null;
  compsCents: number;
  discountsCents: number;
  covers: number | null;
  laborMinutes: number | null;
  laborCostCents: number | null;
  notes: string | null;
};

export type FieldError = { field: string; message: string };

/**
 * "$1,240.50" → 124050.
 *
 * Accepts what a person actually types off a POS printout: currency
 * symbols, thousands separators, stray spaces. Returns null for empty
 * and NaN-free integers for everything else, so a caller can tell
 * "nothing entered" from "entered zero" — a distinction that matters,
 * because zero sales on a Tuesday is a real answer.
 */
export function parseMoneyToCents(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[$£€,\s]/g, "");
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "" || cleaned === ".") return Number.NaN;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return Number.NaN;
  // Round rather than truncate: 12.345 entered by hand means 12.35, and
  // truncating quietly loses a cent on every third entry.
  return Math.round(value * 100);
}

/** "7.5" or "7:30" → 450 minutes. Restaurants write both. */
export function parseHoursToMinutes(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const colon = raw.match(/^(\d+):([0-5]\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  if (!/^\d*\.?\d*$/.test(raw)) return Number.NaN;
  const value = Number(raw);
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * 60);
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Validate a close-out. Returns EVERY problem, not the first — a form
 * that reveals its objections one at a time is a form people abandon at
 * the end of a fourteen-hour day.
 */
export function validateShift(draft: Partial<ShiftDraft>, today = new Date()): FieldError[] {
  const errors: FieldError[] = [];

  if (!draft.serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.serviceDate)) {
    errors.push({ field: "serviceDate", message: "Pick the date of the service." });
  } else {
    // A close-out for next Tuesday is a mis-tap, and it silently poisons
    // any average that includes it.
    const entered = new Date(`${draft.serviceDate}T12:00:00Z`);
    const limit = new Date(today);
    limit.setUTCHours(23, 59, 59, 999);
    if (entered.getTime() > limit.getTime()) {
      errors.push({ field: "serviceDate", message: "That date is in the future." });
    }
  }

  if (draft.period !== undefined && !PERIODS.includes(draft.period)) {
    errors.push({ field: "period", message: "Pick a service." });
  }

  const net = draft.netSalesCents;
  if (net === null || net === undefined || Number.isNaN(net)) {
    errors.push({ field: "netSalesCents", message: "Net sales is the one number this needs." });
  } else if (net < 0) {
    errors.push({ field: "netSalesCents", message: "Net sales cannot be negative." });
  } else if (net > 100_000_00) {
    // A hundred thousand dollars in one service is a decimal slip in
    // every restaurant this product is for.
    errors.push({ field: "netSalesCents", message: "That is over $100,000 — check the decimal point." });
  }

  for (const [field, label] of [
    ["foodSalesCents", "Food sales"],
    ["bevSalesCents", "Beverage sales"],
    ["compsCents", "Comps"],
    ["discountsCents", "Discounts"],
    ["laborCostCents", "Labour cost"],
  ] as const) {
    const value = draft[field];
    if (value === null || value === undefined) continue;
    if (Number.isNaN(value)) errors.push({ field, message: `${label} is not a number.` });
    else if (value < 0) errors.push({ field, message: `${label} cannot be negative.` });
  }

  // The split has to fit inside the total. Getting this wrong is the
  // commonest close-out error and it makes food cost % nonsense.
  if (typeof net === "number" && !Number.isNaN(net)) {
    const food = draft.foodSalesCents ?? null;
    const bev = draft.bevSalesCents ?? null;
    if (food !== null && !Number.isNaN(food) && food > net) {
      errors.push({ field: "foodSalesCents", message: `Food sales is more than net sales (${money(net)}).` });
    }
    if (bev !== null && !Number.isNaN(bev) && bev > net) {
      errors.push({ field: "bevSalesCents", message: `Beverage sales is more than net sales (${money(net)}).` });
    }
    if (food !== null && bev !== null && !Number.isNaN(food) && !Number.isNaN(bev) && food + bev > net + 100) {
      // A dollar of slack, because tax rounding and a "other" category
      // legitimately make these not add up to the cent.
      errors.push({
        field: "foodSalesCents",
        message: `Food plus beverage is ${money(food + bev)}, more than net sales of ${money(net)}.`,
      });
    }
  }

  if (draft.covers !== null && draft.covers !== undefined) {
    if (!Number.isInteger(draft.covers) || draft.covers < 0) {
      errors.push({ field: "covers", message: "Covers has to be a whole number." });
    } else if (draft.covers > 5000) {
      errors.push({ field: "covers", message: "That is over 5,000 covers — check the number." });
    }
  }

  if (draft.laborMinutes !== null && draft.laborMinutes !== undefined) {
    if (Number.isNaN(draft.laborMinutes) || draft.laborMinutes < 0) {
      errors.push({ field: "laborMinutes", message: "Labour hours is not a number." });
    } else if (draft.laborMinutes > 60 * 500) {
      errors.push({ field: "laborMinutes", message: "That is over 500 hours in one service." });
    }
  }

  if (draft.notes && draft.notes.length > 1000) {
    errors.push({ field: "notes", message: "Keep the note under 1,000 characters." });
  }

  return errors;
}

// ── Derived numbers ──────────────────────────────────────────────
// Computed here rather than stored, so a corrected close-out corrects
// every number that depends on it rather than leaving a stale total.

export type ShiftTotals = {
  averageCheckCents: number | null;
  salesPerLaborHourCents: number | null;
  laborPctOfSales: number | null;
  bevMixPct: number | null;
};

export function shiftTotals(row: {
  netSalesCents: number;
  covers?: number | null;
  laborMinutes?: number | null;
  laborCostCents?: number | null;
  bevSalesCents?: number | null;
}): ShiftTotals {
  const covers = row.covers ?? 0;
  const minutes = row.laborMinutes ?? 0;
  return {
    // Null, never zero, when the denominator is missing. A zero average
    // check reads as a catastrophic night rather than as missing data.
    averageCheckCents: covers > 0 ? Math.round(row.netSalesCents / covers) : null,
    salesPerLaborHourCents: minutes > 0 ? Math.round(row.netSalesCents / (minutes / 60)) : null,
    laborPctOfSales:
      row.laborCostCents != null && row.netSalesCents > 0
        ? (row.laborCostCents / row.netSalesCents) * 100
        : null,
    bevMixPct:
      row.bevSalesCents != null && row.netSalesCents > 0
        ? (row.bevSalesCents / row.netSalesCents) * 100
        : null,
  };
}

/** YYYY-MM-DD for a Date, in UTC — service dates are stored as bare
 *  DATE and must not drift by a timezone on the way in or out. */
export function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** The service date a close-out typed "now" most likely belongs to.
 *  Before 5am, that is yesterday: a close-out done at 1:30am Saturday is
 *  Friday's service, and defaulting to today would file it a day late
 *  every single night. */
export function likelyServiceDate(now: Date, cutoffHour = 5) {
  const shifted = new Date(now.getTime() - cutoffHour * 60 * 60 * 1000);
  return dateKey(shifted);
}
