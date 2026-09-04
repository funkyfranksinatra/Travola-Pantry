// tests/ordering.test.ts — the suggested-order maths, hammered with the
// worked numbers from the build brief: beef bought as a 25 lb case,
// counted in lb, $187.50 a case.
import test from "node:test";
import assert from "node:assert/strict";
import { usagePer1000, theoreticalOnHand, suggestOrder, forecastSalesCents } from "../lib/ordering";
import { threeWayMatch, type UnitSpec } from "../lib/inventory";

const beef: UnitSpec = { countPerPurchase: 25, usagePerCount: 16, lastCostCents: 18750 };

// ── usage per $1,000 ─────────────────────────────────────────────

test("50 lb used across $8,000 of sales is 6.25 lb per $1,000", () => {
  const { rate } = usagePer1000({ windowUsageCount: 50, windowSalesCents: 800_000 });
  assert.equal(rate, 6.25);
});

test("no bookend counts, or no sales, means NO rate — with the reason", () => {
  const missing = usagePer1000({ windowUsageCount: null, windowSalesCents: 800_000 });
  assert.equal(missing.rate, null);
  assert.match(missing.reason!, /bookend/);
  const dead = usagePer1000({ windowUsageCount: 50, windowSalesCents: 0 });
  assert.equal(dead.rate, null);
  assert.match(dead.reason!, /no sales/);
});

test("negative usage (a miscount) clamps the rate to zero, never negative", () => {
  const { rate } = usagePer1000({ windowUsageCount: -10, windowSalesCents: 800_000 });
  assert.equal(rate, 0);
});

// ── theoretical on-hand ──────────────────────────────────────────

test("counted 60 lb, received a case, sold $4,000 since → 60 + 25 − 25 = 60 lb", () => {
  const { onHand } = theoreticalOnHand({
    lastCountQty: 60,
    receivedPurchaseQtySince: 1,
    salesCentsSince: 400_000,
    ratePer1000: 6.25,
    spec: beef,
  });
  assert.equal(onHand, 60);
});

test("on-hand never goes below zero — a negative shelf is a rate error", () => {
  const { onHand } = theoreticalOnHand({
    lastCountQty: 5, receivedPurchaseQtySince: 0, salesCentsSince: 4_000_000, ratePer1000: 6.25, spec: beef,
  });
  assert.equal(onHand, 0);
});

test("no count or no rate → null on-hand, with the reason", () => {
  const noCount = theoreticalOnHand({ lastCountQty: null, receivedPurchaseQtySince: 0, salesCentsSince: 0, ratePer1000: 6.25, spec: beef });
  assert.equal(noCount.onHand, null);
  assert.match(noCount.reason!, /no approved count/);
  const noRate = theoreticalOnHand({ lastCountQty: 60, receivedPurchaseQtySince: 0, salesCentsSince: 0, ratePer1000: null, spec: beef });
  assert.equal(noRate.onHand, null);
});

// ── the suggestion ───────────────────────────────────────────────

test("expected 62.5 lb over the horizon with 20 on the shelf → order 2 cases (round UP)", () => {
  // 6.25 lb/$1k × $10,000 horizon = 62.5 lb needed; 42.5 short; 42.5/25 = 1.7 → 2 cases.
  const suggestion = suggestOrder({ onHandCount: 20, ratePer1000: 6.25, horizonSalesCents: 1_000_000, spec: beef });
  assert.equal(suggestion!.purchaseQty, 2);
  assert.ok(Math.abs(suggestion!.neededCount - 42.5) < 1e-9);
});

test("a well-stocked shelf suggests zero, and a sliver of need is noise, not a case", () => {
  const stocked = suggestOrder({ onHandCount: 100, ratePer1000: 6.25, horizonSalesCents: 1_000_000, spec: beef });
  assert.equal(stocked!.purchaseQty, 0);
  // 0.5 lb short of a 25 lb case = 2% of a case — noise from the rate.
  const sliver = suggestOrder({ onHandCount: 62, ratePer1000: 6.25, horizonSalesCents: 1_000_000, spec: beef });
  assert.equal(sliver!.purchaseQty, 0);
});

test("nulls propagate: no on-hand or no rate → no suggestion at all", () => {
  assert.equal(suggestOrder({ onHandCount: null, ratePer1000: 6.25, horizonSalesCents: 100, spec: beef }), null);
  assert.equal(suggestOrder({ onHandCount: 20, ratePer1000: null, horizonSalesCents: 100, spec: beef }), null);
});

test("forecast is a plain trailing average stretched over the horizon", () => {
  // $28,000 over 28 days → $1,000/day → $9,000 over a 7+2 day horizon.
  assert.equal(forecastSalesCents(2_800_000, 28, 9), 900_000);
  assert.equal(forecastSalesCents(0, 0, 7), 0);
});

// ── caps and contracts in the match ──────────────────────────────

test("a 10% category cap silences an 8% move and catches a 22% one", () => {
  const capped = threeWayMatch({
    invoiceTotalCents: null,
    lines: [
      { itemName: "Beef", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 20250, previousCostCents: 18750, capPct: 10 }, // +8%
      { itemName: "Oil", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 6100, previousCostCents: 5000, capPct: 10 },   // +22%
    ],
  });
  assert.equal(capped.problems.length, 1);
  const flagged = capped.problems[0] as { itemName: string; capPct: number };
  assert.equal(flagged.itemName, "Oil");
  assert.equal(flagged.capPct, 10);
});

test("no cap set falls back to the 2% default — today's behaviour, unregressed", () => {
  const { problems } = threeWayMatch({
    invoiceTotalCents: null,
    lines: [{ itemName: "Beef", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 19350, previousCostCents: 18750 }], // +3.2%
  });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, "price_changed");
});

test("a cent over contract is a violation; at contract is not", () => {
  const over = threeWayMatch({
    invoiceTotalCents: null,
    lines: [{ itemName: "Buns", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 2401, previousCostCents: 2401, contractPriceCents: 2400 }],
  });
  assert.deepEqual(over.problems.map((p) => p.kind), ["contract_violation"]);
  const at = threeWayMatch({
    invoiceTotalCents: null,
    lines: [{ itemName: "Buns", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 2400, previousCostCents: 2400, contractPriceCents: 2400 }],
  });
  assert.equal(at.problems.length, 0);
});

test("caps and contracts stack: one line can carry both problems", () => {
  const { problems } = threeWayMatch({
    invoiceTotalCents: null,
    lines: [{ itemName: "Oil", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 6100, previousCostCents: 5000, capPct: 10, contractPriceCents: 5000 }],
  });
  assert.deepEqual(problems.map((p) => p.kind).sort(), ["contract_violation", "price_changed"]);
});
