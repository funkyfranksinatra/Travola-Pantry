"use client";

// app/(pantry)/order/page.tsx — the order sheet.
//
// The manager's question is "what do we need?", never "what do we need
// from Sysco?". So the sheet is item-first: theoretical on-hand and a
// suggested quantity per item, from the same arithmetic the variance
// report trusts — and the vendor split happens at the end, one PO per
// preferred vendor, in one click.
//
// Items the maths cannot support show their REASON in place of a
// suggestion. A zero would read as "don't order", which is exactly
// wrong for an item that has simply never been counted twice.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { money, dateLabel } from "@/lib/format";

type Row = {
  itemId: string; name: string; roomName: string; category: string;
  purchaseUnit: string; countUnit: string; preferredVendor: string;
  lastCostCents: number; parLevel: number | null; isKeyItem: boolean;
  lastCountQty: number | null; lastCountAt: string | null;
  ratePer1000: number | null; onHandCount: number | null;
  reason?: string;
  suggestedPurchaseQty: number | null; neededCount: number | null; estCostCents: number | null;
};
type SheetData = {
  ready: boolean; reason?: string; horizonDays: number; bufferDays: number;
  window?: { from: string; to: string; salesCents: number };
  forecast?: { trailingDays: number; trailingSalesCents: number; horizonSalesCents: number };
  rows: Row[];
};

export default function OrderPage() {
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [horizon, setHorizon] = useState("7");
  const [buffer, setBuffer] = useState("0");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [fallbackVendor, setFallbackVendor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (horizonDays: string, bufferDays: string) => {
    const response = await fetch(`/api/ordering?horizon=${horizonDays || 7}&buffer=${bufferDays || 0}`);
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not load."); return; }
    setSheet(body);
    // Prefill every quantity with its suggestion — the manager edits
    // the exceptions, not every line.
    const prefill: Record<string, string> = {};
    for (const row of body.rows ?? []) {
      if (row.suggestedPurchaseQty != null && row.suggestedPurchaseQty > 0) prefill[row.itemId] = String(row.suggestedPurchaseQty);
    }
    setQty(prefill);
  }, []);
  useEffect(() => { load("7", "0"); }, [load]);

  const rows = sheet?.rows ?? [];
  const orderable = rows.filter((row) => row.suggestedPurchaseQty != null);
  const blocked = rows.filter((row) => row.suggestedPurchaseQty == null);

  // The vendor split, live: what one click will create.
  const groups = new Map<string, { lines: Array<{ row: Row; qty: number }>; costCents: number }>();
  for (const row of orderable) {
    const amount = Number(qty[row.itemId]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const vendor = row.preferredVendor.trim();
    const group = groups.get(vendor) ?? { lines: [], costCents: 0 };
    group.lines.push({ row, qty: amount });
    group.costCents += Math.round(amount * row.lastCostCents);
    groups.set(vendor, group);
  }
  const needsFallback = groups.has("") && !fallbackVendor.trim();
  const totalCents = [...groups.values()].reduce((sum, group) => sum + group.costCents, 0);

  async function createOrders() {
    setBusy(true); setError(null); setNote(null);
    try {
      const orders = [...groups.entries()].map(([vendor, group]) => ({
        vendorName: vendor || fallbackVendor.trim(),
        lines: group.lines.map((line) => ({ itemId: line.row.itemId, qtyOrdered: line.qty })),
      }));
      const response = await fetch("/api/ordering", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", orders }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create the orders.");
      setNote(`Created ${body.created.length} purchase order${body.created.length === 1 ? "" : "s"} — ${body.created.map((c: { vendorName: string }) => c.vendorName).join(", ")}. They are on the Purchases tab, ready to send and receive.`);
      await load(horizon, buffer);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (!sheet) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Order"
        title="The order sheet"
        note="What should be on the shelf right now, and what to order so it lasts the horizon — learned from your approved counts and sales, without walking to the walk-in."
        right={
          <div className="flex items-end gap-3">
            <label className="block">
              <span className="label block mb-1.5">Days to cover</span>
              <input className={`${inputClass} w-20 text-right tabular-nums`} inputMode="numeric" value={horizon}
                onChange={(e) => setHorizon(e.target.value)}
                onBlur={() => load(horizon, buffer)} />
            </label>
            <label className="block">
              <span className="label block mb-1.5">Buffer days</span>
              <input className={`${inputClass} w-20 text-right tabular-nums`} inputMode="numeric" value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                onBlur={() => load(horizon, buffer)} title="Thaw or prep days the product sits unused — they stretch how long the shelf must last." />
            </label>
          </div>
        }
      />
      {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}
      {note && !error ? <Card className="p-4 border-l-2 border-l-state-avail"><p className="text-sm text-state-avail">{note}</p></Card> : null}

      {!sheet.ready ? (
        <Card className="p-5"><Empty>{sheet.reason}</Empty></Card>
      ) : (
        <>
          <p className="text-sm text-ink-400">
            Usage learned from {dateLabel(String(sheet.window!.from).slice(0, 10))} → {dateLabel(String(sheet.window!.to).slice(0, 10))}
            {" "}({money(sheet.window!.salesCents)} sales) · expecting {money(sheet.forecast!.horizonSalesCents)} over the next {sheet.horizonDays + sheet.bufferDays} days
            {" "}(trailing {sheet.forecast!.trailingDays}-day average).
          </p>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr>
                  <th>Item</th>
                  <th className="text-right" title="Last approved count, plus deliveries since, minus usage rate × sales since.">On shelf (theo)</th>
                  <th className="text-right">Par</th>
                  <th className="text-right" title="Count units used per $1,000 of net sales.">Usage / $1k</th>
                  <th className="text-right">Suggested</th>
                  <th className="text-right">Order</th>
                  <th className="text-right">Est. cost</th>
                </tr></thead>
                <tbody>
                  {orderable.map((row) => {
                    const amount = Number(qty[row.itemId]);
                    const est = Number.isFinite(amount) && amount > 0 ? Math.round(amount * row.lastCostCents) : 0;
                    return (
                      <tr key={row.itemId}>
                        <td>
                          <span className="text-ink-50">{row.name}</span>
                          <span className="block text-[11px] text-ink-400 mt-0.5">
                            {row.roomName}{row.preferredVendor ? ` · ${row.preferredVendor}` : " · no preferred vendor"}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{row.onHandCount!.toFixed(1)} {row.countUnit}</td>
                        <td className="text-right tabular-nums text-ink-400">{row.parLevel != null ? row.parLevel : "—"}</td>
                        <td className="text-right tabular-nums text-ink-400">{row.ratePer1000!.toFixed(2)}</td>
                        <td className="text-right tabular-nums">
                          {row.suggestedPurchaseQty} {row.purchaseUnit}
                        </td>
                        <td className="text-right">
                          <input
                            inputMode="numeric"
                            className="w-16 rounded-lg bg-panel border border-border px-2 py-1.5 text-right text-sm text-ink-50 tabular-nums focus:border-ai outline-none"
                            value={qty[row.itemId] ?? ""}
                            placeholder="0"
                            onChange={(e) => setQty((current) => ({ ...current, [row.itemId]: e.target.value }))}
                          />
                        </td>
                        <td className="text-right tabular-nums">{est ? money(est) : "—"}</td>
                      </tr>
                    );
                  })}
                  {!orderable.length ? (
                    <tr><td colSpan={7} className="text-ink-400 text-center py-6">Nothing the maths can suggest yet — see the items below for why.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── The vendor split ── what one click creates. */}
          {groups.size ? (
            <Card className="p-5">
              <SectionHeading title="This becomes" note="One purchase order per preferred vendor. Each lands on the Purchases tab as an open order, priced at current cost — receiving corrects prices as ever." />
              <ul className="space-y-1.5 text-sm text-ink-200 mb-4">
                {[...groups.entries()].map(([vendor, group]) => (
                  <li key={vendor || "(none)"} className="flex items-center gap-3">
                    <span className="text-ink-50 font-semibold">{vendor || "No preferred vendor"}</span>
                    <span className="text-ink-400">{group.lines.length} line{group.lines.length === 1 ? "" : "s"} · {money(group.costCents)}</span>
                    {!vendor ? (
                      <input className={`${inputClass} max-w-[220px]`} placeholder="Vendor for these items…" value={fallbackVendor}
                        onChange={(e) => setFallbackVendor(e.target.value)} />
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-3">
                <Button tone="primary" disabled={busy || needsFallback} onClick={createOrders}>
                  Create {groups.size} purchase order{groups.size === 1 ? "" : "s"} · {money(totalCents)}
                </Button>
                {needsFallback ? <span className="text-xs text-ink-400">Name a vendor for the unassigned items first — or set preferred vendors in the room editor.</span> : null}
              </div>
            </Card>
          ) : null}

          {/* ── The honest bottom ── items with no suggestion, and why. */}
          {blocked.length ? (
            <Card className="p-5">
              <SectionHeading title="No suggestion yet" note="Each item names why. The fix is almost always the same: get the item into two approved counts, and the sheet learns its rate." />
              <ul className="grid gap-1.5 sm:grid-cols-2 text-sm">
                {blocked.map((row) => (
                  <li key={row.itemId} className="flex justify-between gap-3 rounded-lg bg-panel-up/30 border border-border px-3.5 py-2">
                    <span className="text-ink-50 truncate">{row.name}</span>
                    <span className="text-ink-400 text-xs shrink-0 self-center">{row.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
