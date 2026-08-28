// tests/shift.test.ts — the close-out rules.
//
// Every case here is one a manager hits at 1am. The money parser gets
// the most attention because it is the boundary between what a person
// types off a printout and an integer that ends up in a cost percentage.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  likelyServiceDate,
  parseHoursToMinutes,
  parseMoneyToCents,
  shiftTotals,
  validateShift,
} from "../lib/shift";

// ── money parsing ────────────────────────────────────────────────

test("money accepts what people actually type off a printout", () => {
  assert.equal(parseMoneyToCents("1240.50"), 124050);
  assert.equal(parseMoneyToCents("$1,240.50"), 124050);
  assert.equal(parseMoneyToCents("  1240 "), 124000);
  assert.equal(parseMoneyToCents("1,240"), 124000);
  assert.equal(parseMoneyToCents("0"), 0);
});

test("empty is null, not zero — no sales entered is not zero sales", () => {
  assert.equal(parseMoneyToCents(""), null);
  assert.equal(parseMoneyToCents("   "), null);
  assert.equal(parseMoneyToCents(null), null);
});

test("junk is NaN, so it is caught rather than silently becoming zero", () => {
  assert.ok(Number.isNaN(parseMoneyToCents("abc") as number));
  assert.ok(Number.isNaN(parseMoneyToCents("12.3.4") as number));
  assert.ok(Number.isNaN(parseMoneyToCents(".") as number));
});

test("a third cent rounds rather than truncating", () => {
  // 12.345 * 100 = 1234.4999... in binary floating point. Truncating
  // here loses a cent on a large fraction of hand-typed entries.
  assert.equal(parseMoneyToCents("12.345"), 1235);
  assert.equal(parseMoneyToCents("0.005"), 1);
});

test("a classic float trap stays exact", () => {
  assert.equal(parseMoneyToCents("1.1"), 110);
  assert.equal(parseMoneyToCents("2.675"), 268);
});

// ── hours ────────────────────────────────────────────────────────

test("hours accept both decimal and clock notation", () => {
  assert.equal(parseHoursToMinutes("7.5"), 450);
  assert.equal(parseHoursToMinutes("7:30"), 450);
  assert.equal(parseHoursToMinutes("8"), 480);
  assert.equal(parseHoursToMinutes(""), null);
  assert.ok(Number.isNaN(parseHoursToMinutes("half past") as number));
});

// ── validation ───────────────────────────────────────────────────

const base = { serviceDate: "2026-08-20", period: "all_day" as const, netSalesCents: 500000 };

test("net sales is the one required number", () => {
  const problems = validateShift({ ...base, netSalesCents: null });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].field, "netSalesCents");
});

test("zero sales is allowed — a dead Tuesday is a real answer", () => {
  assert.equal(validateShift({ ...base, netSalesCents: 0 }).length, 0);
});

test("a future service date is rejected", () => {
  const today = new Date("2026-08-20T12:00:00Z");
  assert.equal(validateShift({ ...base, serviceDate: "2026-08-21" }, today).length, 1);
  assert.equal(validateShift({ ...base, serviceDate: "2026-08-20" }, today).length, 0);
});

test("a decimal slip in net sales is caught", () => {
  const problems = validateShift({ ...base, netSalesCents: 12_000_000 });
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /decimal/);
});

test("food or beverage larger than net sales is a typo, and is named as one", () => {
  const food = validateShift({ ...base, foodSalesCents: 600000 });
  assert.equal(food.length, 1);
  assert.equal(food[0].field, "foodSalesCents");
  const bev = validateShift({ ...base, bevSalesCents: 600000 });
  assert.equal(bev[0].field, "bevSalesCents");
});

test("food plus beverage over net sales is caught, with a dollar of slack for rounding", () => {
  // Exactly equal is fine.
  assert.equal(validateShift({ ...base, foodSalesCents: 400000, bevSalesCents: 100000 }).length, 0);
  // 50c over is inside the slack.
  assert.equal(validateShift({ ...base, foodSalesCents: 400000, bevSalesCents: 100050 }).length, 0);
  // Ten dollars over is not.
  assert.equal(validateShift({ ...base, foodSalesCents: 400000, bevSalesCents: 101000 }).length, 1);
});

test("negative money is rejected everywhere it can be entered", () => {
  for (const field of ["foodSalesCents", "bevSalesCents", "compsCents", "discountsCents", "laborCostCents"] as const) {
    assert.equal(validateShift({ ...base, [field]: -1 }).length, 1, field);
  }
});

test("covers must be a whole, sane number", () => {
  assert.equal(validateShift({ ...base, covers: 12.5 }).length, 1);
  assert.equal(validateShift({ ...base, covers: -1 }).length, 1);
  assert.equal(validateShift({ ...base, covers: 9000 }).length, 1);
  assert.equal(validateShift({ ...base, covers: 0 }).length, 0);
});

test("every problem is reported at once, not one at a time", () => {
  const problems = validateShift({
    serviceDate: "not-a-date",
    netSalesCents: null,
    covers: -4,
    foodSalesCents: -1,
  });
  assert.equal(problems.length, 4);
});

// ── derived numbers ──────────────────────────────────────────────

test("average check is null without covers, never zero", () => {
  assert.equal(shiftTotals({ netSalesCents: 500000, covers: null }).averageCheckCents, null);
  assert.equal(shiftTotals({ netSalesCents: 500000, covers: 0 }).averageCheckCents, null);
  assert.equal(shiftTotals({ netSalesCents: 500000, covers: 80 }).averageCheckCents, 6250);
});

test("sales per labour hour divides by hours, not minutes", () => {
  const totals = shiftTotals({ netSalesCents: 500000, laborMinutes: 600 });
  assert.equal(totals.salesPerLaborHourCents, 50000); // $5,000 over 10 hours
});

test("labour percentage and beverage mix are null when the input is missing", () => {
  const totals = shiftTotals({ netSalesCents: 500000 });
  assert.equal(totals.laborPctOfSales, null);
  assert.equal(totals.bevMixPct, null);
});

// ── the service date default ─────────────────────────────────────

test("a close-out at 1am belongs to the night before", () => {
  // 01:30 UTC on the 21st is still the 20th's service.
  assert.equal(likelyServiceDate(new Date("2026-08-21T01:30:00Z")), "2026-08-20");
});

test("a close-out in the evening belongs to that same day", () => {
  assert.equal(likelyServiceDate(new Date("2026-08-20T23:30:00Z")), "2026-08-20");
});

test("the cutoff is 5am, so an early-morning prep shift is not misfiled", () => {
  assert.equal(likelyServiceDate(new Date("2026-08-21T04:59:00Z")), "2026-08-20");
  assert.equal(likelyServiceDate(new Date("2026-08-21T05:01:00Z")), "2026-08-21");
});
