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
- **Reconciliation blocks on disagreement** and proceeds only with an
  explicit acknowledgement. Averaging away a mismatch is how AP
  automation earns distrust.
