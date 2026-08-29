// tests/inventory.test.ts — the unit maths and the AvT engine.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  costPerCountCents, costPerUsageCents, isOutlier, lineValueCents,
  plateCostCents, plateMarginPct, purchaseToCount, threeWayMatch,
  usageToCount, validateItem, varianceForItem,
} from "../lib/inventory";

// A case of 24 bottles at $48; each bottle 33.8 oz.
const wine = { countPerPurchase: 24, usagePerCount: 33.8, lastCostCents: 4800 };
// Beef: case of 25 lb at $187.50; recipes use oz.
const beef = { countPerPurchase: 25, usagePerCount: 16, lastCostCents: 18750 };

// ── conversions ──────────────────────────────────────────────────

test("cost flows purchase → count → usage", () => {
  assert.equal(costPerCountCents(wine), 200);            // $2/bottle
  assert.equal(costPerCountCents(beef), 750);            // $7.50/lb
  assert.ok(Math.abs(costPerUsageCents(beef) - 46.875) < 1e-9); // ~47¢/oz
});

test("a zero conversion never divides — it prices as zero, caught by validation", () => {
  const broken = { countPerPurchase: 0, usagePerCount: 0, lastCostCents: 4800 };
  assert.equal(costPerCountCents(broken), 0);
  assert.equal(costPerUsageCents(broken), 0);
});

test("validation rejects the zero-conversion poison value", () => {
  assert.equal(validateItem({ name: "Oil", countPerPurchase: 0 }).length, 1);
  assert.equal(validateItem({ name: "Oil", usagePerCount: -2 }).length, 1);
  assert.equal(validateItem({ name: "Oil", countPerPurchase: 6, usagePerCount: 128 }).length, 0);
});

test("line value rounds once, at the value step", () => {
  // 3 lb of beef at 750¢/lb = 2250¢ exactly; 1.5 bottles at 200 = 300.
  assert.equal(lineValueCents(beef, 3), 2250);
  assert.equal(lineValueCents(wine, 1.5), 300);
  // A third of a case of something priced oddly rounds, not truncates.
  assert.equal(lineValueCents({ countPerPurchase: 3, usagePerCount: 1, lastCostCents: 1000 }, 1), 333);
});

// ── outlier guard ────────────────────────────────────────────────

test("40 for 4 is challenged; 2 for 0 is restocking", () => {
  assert.ok(isOutlier(40, 4));
  assert.ok(isOutlier(0, 12));
  assert.ok(!isOutlier(2, 0));
  assert.ok(!isOutlier(3, 1));      // small numbers stay quiet
  assert.ok(!isOutlier(6, 4));      // ordinary week-to-week movement
  assert.ok(!isOutlier(5, null));   // first count is never an outlier
});

test("a slipped digit on a big count is caught at 4×, not 8×", () => {
  assert.ok(isOutlier(400, 80));    // 400 typed for 40
  assert.ok(isOutlier(4, 30));      // a dropped digit going down
  assert.ok(!isOutlier(60, 30));    // a busy week doubling is not a typo
  assert.ok(!isOutlier(75, 25));    // 3× on restock day is plausible
});

// ── AvT ──────────────────────────────────────────────────────────

test("the beef example from the brief: 50 lb theoretical, 60 lb gone → 10 lb variance", () => {
  const row = varianceForItem({
    itemId: "b", itemName: "Beef", spec: beef,
    openingQty: 80, closingQty: 45, receivedPurchaseQty: 1, // 80 + 25 − 45 = 60 lb actual
    wasteQty: 0,
    theoreticalUsageQty: 800, // oz → 50 lb
  });
  assert.equal(row.actualUsageCount, 60);
  assert.equal(row.theoreticalUsageCount, 50);
  assert.equal(row.varianceCount, 10);
  assert.equal(row.varianceValueCents, 7500); // 10 lb × $7.50
});

test("logged waste explains variance instead of accusing", () => {
  const row = varianceForItem({
    itemId: "b", itemName: "Beef", spec: beef,
    openingQty: 80, closingQty: 45, receivedPurchaseQty: 1,
    wasteQty: 10, // the 10 lb went in the bin, with a reason
    theoreticalUsageQty: 800,
  });
  assert.equal(row.varianceCount, 0);
});

test("no bookend count → no actual, no variance — never a guess", () => {
  const row = varianceForItem({
    itemId: "b", itemName: "Beef", spec: beef,
    openingQty: null, closingQty: 45, receivedPurchaseQty: 1,
    wasteQty: 0, theoreticalUsageQty: 800,
  });
  assert.equal(row.actualUsageCount, null);
  assert.equal(row.varianceCount, null);
});

test("no recipe → theoretical is null, actual still reported", () => {
  const row = varianceForItem({
    itemId: "b", itemName: "Beef", spec: beef,
    openingQty: 80, closingQty: 45, receivedPurchaseQty: 0,
    wasteQty: 0, theoreticalUsageQty: null,
  });
  assert.equal(row.actualUsageCount, 35);
  assert.equal(row.theoreticalUsageCount, null);
  assert.equal(row.varianceCount, null);
});

// ── recipe costing ───────────────────────────────────────────────

test("the burger from the brief prices correctly and reprices when oil ripples", () => {
  const bun  = { countPerPurchase: 8, usagePerCount: 1, lastCostCents: 400 };  // 50¢ a bun
  const cheese = { countPerPurchase: 120, usagePerCount: 1, lastCostCents: 3600 }; // 30¢ a slice
  const cost = plateCostCents([
    { quantity: 1, spec: bun },
    { quantity: 6, spec: beef },   // 6 oz × 46.875¢
    { quantity: 1, spec: cheese },
  ]);
  assert.equal(cost, 50 + 281 + 30); // 361¢
  // The ripple: beef case goes to $200. Same lines, new spec, new cost.
  const dearBeef = { ...beef, lastCostCents: 20000 };
  const newCost = plateCostCents([
    { quantity: 1, spec: bun },
    { quantity: 6, spec: dearBeef },
    { quantity: 1, spec: cheese },
  ]);
  assert.equal(newCost, 50 + 300 + 30);
});

test("margin is null on a zero price, never infinity", () => {
  assert.equal(plateMarginPct(0, 361), null);
  assert.ok(Math.abs((plateMarginPct(1600, 361) ?? 0) - 77.4375) < 1e-6);
});

// ── three-way match ──────────────────────────────────────────────

test("shorted case, repriced oil and a mismatched invoice all surface", () => {
  const { problems, receivedTotalCents } = threeWayMatch({
    invoiceTotalCents: 40000,
    lines: [
      { itemName: "Beef", qtyOrdered: 2, qtyReceived: 1, unitCostCents: 18750, previousCostCents: 18750 },
      { itemName: "Oil", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 6100, previousCostCents: 5000 },
    ],
  });
  assert.equal(receivedTotalCents, 18750 + 6100);
  const kinds = problems.map((p) => p.kind).sort();
  assert.deepEqual(kinds, ["invoice_mismatch", "price_changed", "short"]);
  const price = problems.find((p) => p.kind === "price_changed") as { pct: number };
  assert.ok(Math.abs(price.pct - 22) < 0.01);
});

test("a clean delivery has no problems and a dollar of invoice slack", () => {
  const { problems } = threeWayMatch({
    invoiceTotalCents: 18790, // 40¢ over — freight rounding, not a fight
    lines: [{ itemName: "Beef", qtyOrdered: 1, qtyReceived: 1, unitCostCents: 18750, previousCostCents: 18750 }],
  });
  assert.equal(problems.length, 0);
});

test("usage↔count round-trips", () => {
  assert.equal(usageToCount(beef, 800), 50);
  assert.equal(purchaseToCount(beef, 2), 50);
});
