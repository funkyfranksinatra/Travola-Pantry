// lib/format.ts — every number Travola Pantry prints goes through here.
//
// Formatting lives in one file because inconsistency reads as sloppiness:
// $1,240 in one card and $1240.00 in the next makes a page look like two
// people built it. The other reason is truthfulness — `dash` is what a
// missing value renders as, and it must never be "0".

const NBSP = "\u00A0"; // non-breaking: "45 min" must never wrap mid-value
export const DASH = "—";

export function money(cents: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return DASH;
  const dollars = cents / 100;
  const showCents = opts.cents ?? Math.abs(dollars) < 1000;
  return dollars.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

export function integer(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return Math.round(value).toLocaleString("en-US");
}

export function decimal(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return value.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

export function percent(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(places)}%`;
}

export function minutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const total = Math.round(value);
  if (Math.abs(total) < 60) return `${total}${NBSP}min`;
  const hours = Math.trunc(total / 60);
  const rest = Math.abs(total % 60);
  return rest ? `${hours}h${NBSP}${rest}m` : `${hours}h`;
}

/** Signed percent for a delta chip: "+12.4%", "−3.1%". */
export function delta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

export function dateLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/** "2026-08-03" -> "3 Aug" for dense tables. */
export function shortDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

export function periodLabel(period: string): string {
  return period.charAt(0) + period.slice(1).toLowerCase();
}
