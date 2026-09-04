// tests/digest.test.ts — the weekly email render, pure and paranoid.
import test from "node:test";
import assert from "node:assert/strict";
import { renderDigest } from "../lib/digest";
import type { VarianceReport } from "../lib/variance-engine";

const baseRow = {
  itemId: "i1", itemName: "Ground beef", roomName: "Walk-in", countUnit: "lb", category: "meat",
  actualUsageCount: 52.5, theoreticalUsageCount: 37.5, wasteCount: 5, wasteValueCents: 3750,
  varianceCount: 10, varianceValueCents: 7500, actualValueCents: 39375, theoreticalValueCents: 28125,
  sharePct: 80.8, hasRecipeUsage: true,
};

const readyReport: VarianceReport = {
  ready: true,
  window: { from: new Date("2026-08-29T10:08:15Z"), to: new Date("2026-09-04T06:24:41Z"), openId: "a", closeId: "b" },
  counts: [],
  hasSalesData: true,
  totals: {
    openingValueCents: 98000, closingValueCents: 80725, varianceValueCents: 2750,
    actualUsageValueCents: 48725, wasteValueCents: 3750, salesCents: 140000, cogsPct: 34.8,
  },
  unmapped: { salesCents: 0, checkSalesCents: 140000, pct: 0 },
  targetPct: null,
  rows: [baseRow],
};

// A clock two days after the window closes — fresh enough that no
// cadence nudge should appear unless a test moves it.
const FRESH = new Date("2026-09-06T12:00:00Z");

test("a ready window renders subject with the food-cost percentage", () => {
  const digest = renderDigest({ restaurantName: "Fixture Bistro", appUrl: "https://x.test", report: readyReport, now: FRESH })!;
  assert.match(digest.subject, /Fixture Bistro/);
  assert.match(digest.subject, /34\.8%/);
  assert.match(digest.html, /\$487\.25/);   // food cost
  assert.match(digest.html, /Ground beef/);
  assert.match(digest.html, /\+10\.0 lb/);
  assert.match(digest.html, /https:\/\/x\.test\/recipes/);
});

test("no countable window means NO email, not an empty one", () => {
  const digest = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: { ready: false, reason: "needs two counts", counts: [] },
  });
  assert.equal(digest, null);
});

test("item names and restaurant names are HTML-escaped", () => {
  const digest = renderDigest({
    restaurantName: 'Bob\'s <script>alert(1)</script> Grill',
    appUrl: "https://x.test",
    report: { ...readyReport, rows: [{ ...baseRow, itemName: '<img src=x onerror=alert(1)>' }] },
    now: FRESH,
  })!;
  assert.ok(!digest.html.includes("<script>"));
  assert.ok(!digest.html.includes("<img src=x"));
  assert.match(digest.html, /&lt;script&gt;/);
});

test("no sales in the window drops the % and says why theoreticals are absent", () => {
  const digest = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: {
      ...readyReport,
      hasSalesData: false,
      totals: { ...readyReport.totals, salesCents: 0, cogsPct: null },
    },
    now: FRESH,
  })!;
  assert.doesNotMatch(digest.subject, /%/);
  assert.match(digest.html, /theoretical usage is unknown/);
});

test("a clean week says so instead of rendering an empty table", () => {
  const digest = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: { ...readyReport, rows: [{ ...baseRow, varianceValueCents: 0, varianceCount: 0 }] },
    now: FRESH,
  })!;
  assert.match(digest.html, /clean week/);
});

test("a target turns the subject and the % tile into a verdict", () => {
  const digest = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: { ...readyReport, targetPct: 30 }, now: FRESH,
  })!;
  assert.match(digest.subject, /target 30%/);
  assert.match(digest.html, /4\.8 pts over/);
});

test("meaningful unmapped sales get the honesty warning; trivial ones stay quiet", () => {
  const loud = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: { ...readyReport, unmapped: { salesCents: 32200, checkSalesCents: 140000, pct: 23 } }, now: FRESH,
  })!;
  assert.match(loud.html, /23% of the window's POS sales/);
  assert.match(loud.html, /no recipe/);
  const quiet = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: { ...readyReport, unmapped: { salesCents: 1400, checkSalesCents: 140000, pct: 1 } }, now: FRESH,
  })!;
  assert.doesNotMatch(quiet.html, /no recipe/);
});

test("a stale closing count earns the cadence nudge; a fresh one does not", () => {
  const stale = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: readyReport, now: new Date("2026-09-14T12:00:00Z"), // 10 days after close
  })!;
  assert.match(stale.html, /closing count is 10 days old/);
  const fresh = renderDigest({
    restaurantName: "Fixture Bistro", appUrl: "https://x.test",
    report: readyReport, now: FRESH,
  })!;
  assert.doesNotMatch(fresh.html, /days old/);
});
