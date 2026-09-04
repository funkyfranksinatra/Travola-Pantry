# Inventory — design notes

## What is built

| Feature from the brief | Status |
|---|---|
| Storage mapping — rooms canvas, drag/resize edit mode, enter a room, shelf-order items | ✅ Built. Settings → "Edit inventory rooms" enters the floor-editor idiom on the Inventory tab. |
| Mobile counting with manager approval | ✅ Built as a phone-first web flow. Staff sign in with the restaurant code, count in shelf order, autosaving per entry; a manager approves or rejects with a reason. |
| Count valuation | ✅ Approved counts freeze a total valuation (snapshot lines — repricing later never rewrites history). |
| Recipe costing | ✅ Per-dish ingredient lines; plate cost, cost % and margin computed at read time. |
| Theoretical depletion | ✅ Recipes × CheckItem quantities from the shared database. |
| AvT variance engine | ✅ Actual (opening + received − closing) vs theoretical vs logged waste, valued, worst-first. |
| Three-way matching | ✅ Order vs received vs invoice; disagreements block reconciliation until acknowledged. |
| Cost rippling | ✅ Receiving at a new price updates the item's cost; every recipe cost derives from it at read time — no propagation job exists because none is needed. |
| Waste log | ✅ (supporting feature, added autonomously — it is what turns variance from an accusation into an explanation). |

### Purchasing intelligence (from the R365 walkthrough catalog, Sep 2026)

| Feature | Status |
|---|---|
| Item categories | ✅ Fixed ten-category list on every item (meat, produce, dairy…) — the axis caps and the cost breakout aggregate on. Free text was rejected: a typo'd category silently falls outside its cap. |
| Per-category price-move caps | ✅ Settings → "Price move caps". A received price moving past its category's ± cap is flagged; no cap set = the old 2% default, so nothing regressed. Catches market moves AND wrong-UoM invoice errors (+20,000%). |
| Contract pricing | ✅ `contractPriceCents` per item; receiving a single cent above it raises a `contract_violation` in the three-way match — it blocks reconciliation like any other disagreement. |
| Cost % breakout | ✅ "% of usage" column on the variance report — each item's share of the window's usage dollars. The lobster house watches the lobster. |
| Food cost % of sales | ✅ Headline tiles on the variance report: window food cost, % of net sales (checks first, typed close-outs fill check-less days), explained-by-waste $, net unexplained $ (with the gross swing footnoted so offsetting errors cannot hide). |
| AvT drill-through | ✅ Every variance row opens in place: the actual side (opening count + each delivery, linked → the purchase, − closing count), dish-by-dish theoretical, and the waste log. |
| Theoretical on-hand | ✅ Last approved count + deliveries since − usage rate × sales since. The rate is usage per $1,000 of net sales, learned from the window between the two newest approved counts — the same arithmetic the variance report trusts. |
| Suggested ordering | ✅ Order tab: expected usage across the horizon (consumption + buffer days, trailing 28-day sales average) minus theoretical on-hand, rounded UP to whole purchase units. Items the maths cannot support print their REASON, never a zero. |
| Shopping list → multi-vendor POs | ✅ The order sheet groups by each item's preferred vendor and creates one purchase order per vendor in one click. |
| Duplicate item merge | ✅ In the room editor: history (counts, recipes, orders, waste) repoints at the survivor, clashing rows are summed, the twin retires. Refused across different units — "3 cases" and "3 lb" cannot be summed. |
| Report subscriptions | ✅ Weekly digest — the window's headline numbers and worst variances — emailed Mondays by a Vercel cron. Needs RESEND_API_KEY + CRON_SECRET on the deployment; until then Settings saves the address and says exactly what to set. The digest renders from the SAME variance engine as the Recipes tab (lib/variance-engine.ts), extracted so the screen and the inbox can never disagree. |
| Units ↔ dollars toggle | ✅ The AvT table renders in count units or dollars — same dataset, two renderings, never two computations. |
| Price verification (single-location) | ✅ "Price watch" on Purchases: each item's latest received price vs the previous distinct one, vendor, % move against its category cap, contract breaches sorted first. |
| Food-cost trend | ✅ "Food cost, window to window" on Today: one bar per counted window, from the LEDGER equation — frozen opening valuation + deliveries at receipt price − frozen closing valuation, over that window's net sales. The variance report's headline uses the same equation, so the two screens agree by construction. |

## Shelved for later architecting — and the seam left for each

**Native iOS/Android counting app.** The count flow is already one-column,
48px targets, numeric keyboards, per-entry autosave. A native wrapper
(Capacitor or similar) ships around the existing `/count` route without
changing it. What a wrapper adds: home-screen icon, camera for barcode
lookup, true offline queueing.

**Live POS connectors (Toast, Square…).** The variance engine reads
`CheckItem` from the shared database. An integration's job is to write
sales into that shape (or a thinner SalesMix table beside it); the
engine does not change. Until then the report says, per item, that
theoretical usage is unknowable — never zero.

**General-ledger posting.** There is no GL in the product. Approved
counts already freeze `totalValueCents`, which IS the inventory-asset
figure a GL entry needs; the QuickBooks/Xero integration that consumes
it is a later phase.

**Vendor EDI feeds.** Invoices arrive by hand. Electronic feeds need
per-vendor integration agreements Travola cannot sign pre-revenue; the
three-way match is the manual stand-in, and a feed would simply create
the same Purchase rows receiving already consumes.

**Invoice scanning / OCR receiving.** Receiving is typed today. The menu
importer's photo-parsing machinery is the obvious thing to point at
invoices; the receiving API already accepts per-line quantity and price
corrections, which is exactly what a parser would emit.

## Decisions worth remembering

- **Three units per item** (purchase / count / usage) with the two
  conversion factors stored on the item. Validation rejects zero — the
  poison value that silently prices everything as free.
- **Approval gates everything.** Only `approved` counts feed valuation
  and variance. A count reprices the building; it gets a second pair of
  eyes. Rejection carries a reason back to the counter.
- **Snapshots on count lines.** Name, unit, cost frozen at count time.
  An approved count is a historical document.
- **No-recipe items have NULL theoretical, not zero.** Zero would file
  fryer oil's whole usage as variance — an accusation the maths cannot
  support.
- **The outlier guard is two-tier**: 8× for small numbers (0→2 bottles
  is restocking), 4× once either side is ≥20 (400 typed for 40 lands at
  5× and must be caught).
- **The usage rate is normalised by SALES, not days** (usage per
  $1,000 of net sales). A slow Tuesday and a slammed Saturday deplete
  differently; a per-day rate would over-order into the quiet week.
- **Suggestions round UP to whole purchase units** — vendors sell whole
  cases, and rounding down converts every fractional need into a
  Saturday-night 86. A sliver under a tenth of a case is noise, not an
  order.
- **Blocked suggestions print their reason** ("not in both bookend
  counts", "no sales in the counted window") at the bottom of the order
  sheet. A silent zero reads as "don't order", which is exactly wrong.
- **The headline food cost is frozen; the row dollars are current.**
  The window's food cost comes from frozen count valuations and actual
  receipt prices — history a later price change can never rewrite. The
  per-row dollar values are priced at TODAY's cost on purpose: they are
  a hunting list for what to fix now, not a ledger.
- **Merging across different units is refused.** Quantities are meaningless
  without their units; the merge sums clashing rows only when the units
  agree.
- **Reconciliation blocks on disagreement** and proceeds only with an
  explicit acknowledgement. Averaging away a mismatch is how AP
  automation earns distrust.
