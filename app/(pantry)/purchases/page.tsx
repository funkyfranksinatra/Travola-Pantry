"use client";

// app/(pantry)/purchases/page.tsx — ordering, receiving, and the
// three-way match.
//
// The page is organised around the delivery truck: create an order,
// mark what actually came off the truck (and at what price — this is
// where cost rippling starts), then reconcile against the paper
// invoice. Disagreements are surfaced loudly and block reconciliation
// until someone says they have looked.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { Delta } from "@/components/charts";
import { money, dateLabel, shortDate } from "@/lib/format";

type Item = { id: string; name: string; purchaseUnit: string; lastCostCents: number };
type PriceRow = {
  itemId: string; name: string; category: string; purchaseUnit: string;
  vendorName: string; paidCents: number; paidAt: string;
  previousCents: number | null; movePct: number | null; capPct: number;
  overCap: boolean; contractPriceCents: number | null; overContract: boolean;
};
type Line = { id: string; itemId: string; itemName: string; purchaseUnit: string; qtyOrdered: number; qtyReceived: number | null; unitCostCents: number };
type Problem =
  | { kind: "short"; itemName: string; ordered: number; received: number }
  | { kind: "over"; itemName: string; ordered: number; received: number }
  | { kind: "price_changed"; itemName: string; wasCents: number; nowCents: number; pct: number; capPct: number }
  | { kind: "contract_violation"; itemName: string; contractCents: number; paidCents: number }
  | { kind: "invoice_mismatch"; invoiceCents: number; receivedCents: number };
type Purchase = {
  id: string; vendorName: string; status: string; orderedAt: string; receivedAt: string | null;
  invoiceNumber: string | null; invoiceTotalCents: number | null; receivedTotalCents: number;
  problems: Problem[]; lines: Line[];
};
type PurchaseSummary = { id: string; vendorName: string; status: string; orderedAt: string; invoiceNumber: string | null; lineCount: number };

const problemText = (p: Problem) =>
  p.kind === "short" ? `${p.itemName}: ordered ${p.ordered}, received ${p.received} — shorted`
  : p.kind === "over" ? `${p.itemName}: ordered ${p.ordered}, received ${p.received} — extra`
  : p.kind === "price_changed" ? `${p.itemName}: ${money(p.wasCents)} → ${money(p.nowCents)} (${p.pct > 0 ? "up" : "down"} ${Math.abs(p.pct).toFixed(0)}% — past the ${p.capPct}% cap for its category)`
  : p.kind === "contract_violation" ? `${p.itemName}: contracted at ${money(p.contractCents)}, invoiced at ${money(p.paidCents)} — contract violation, worth a credit-memo call`
  : `Invoice says ${money(p.invoiceCents)}; received lines total ${money(p.receivedCents)}`;

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<PurchaseSummary[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Purchase | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [vendor, setVendor] = useState("");
  const [draftLines, setDraftLines] = useState<Array<{ itemId: string; qty: string }>>([{ itemId: "", qty: "" }]);
  const [receiveEdits, setReceiveEdits] = useState<Record<string, { qty: string; cost: string }>>({});
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");

  const [prices, setPrices] = useState<PriceRow[] | null>(null);

  const load = useCallback(async () => {
    const [purchasesRes, itemsRes, pricesRes] = await Promise.all([
      fetch("/api/purchases"), fetch("/api/items"), fetch("/api/prices"),
    ]);
    const [purchasesBody, itemsBody, pricesBody] = await Promise.all([purchasesRes.json(), itemsRes.json(), pricesRes.json()]);
    if (!purchasesRes.ok) { setError(purchasesBody.error ?? "Could not load."); return; }
    setPurchases(purchasesBody.purchases);
    setItems((itemsBody.items ?? []).map((item: Item & Record<string, unknown>) => ({
      id: item.id, name: item.name, purchaseUnit: item.purchaseUnit, lastCostCents: item.lastCostCents,
    })));
    setPrices(pricesBody.rows ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep link — ?id= arrives from the variance report's drill-through,
  // so "that delivery looks wrong" opens the delivery itself.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) openPurchase(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setError(null); setNote(null);
    try {
      const response = await fetch("/api/purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "That did not work."); return body.problems ? body : null; }
      return body;
    } finally { setBusy(false); }
  }

  async function openPurchase(id: string) {
    const response = await fetch(`/api/purchases?id=${id}`);
    const body = await response.json();
    if (response.ok) {
      setOpen(body.purchase);
      setReceiveEdits({});
      setInvoiceNumber(body.purchase.invoiceNumber ?? "");
      setInvoiceTotal(body.purchase.invoiceTotalCents == null ? "" : (body.purchase.invoiceTotalCents / 100).toFixed(2));
    }
  }

  async function createOrder(event: React.FormEvent) {
    event.preventDefault();
    const lines = draftLines
      .filter((line) => line.itemId && Number(line.qty) > 0)
      .map((line) => ({ itemId: line.itemId, qtyOrdered: Number(line.qty) }));
    const body = await post({ action: "create", vendorName: vendor, lines });
    if (!body?.ok) return;
    setVendor(""); setDraftLines([{ itemId: "", qty: "" }]); setCreating(false);
    await load(); await openPurchase(body.id);
  }

  async function receive() {
    if (!open) return;
    const body = await post({
      action: "receive", id: open.id,
      receivedBy: "owner",
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceTotalCents: invoiceTotal.trim() === "" ? undefined : Math.round(Number(invoiceTotal.replace(/[$,]/g, "")) * 100),
      lines: open.lines.map((line) => ({
        lineId: line.id,
        qtyReceived: receiveEdits[line.id]?.qty !== undefined && receiveEdits[line.id].qty !== "" ? Number(receiveEdits[line.id].qty) : line.qtyOrdered,
        unitCostCents: receiveEdits[line.id]?.cost !== undefined && receiveEdits[line.id].cost !== "" ? Math.round(Number(receiveEdits[line.id].cost.replace(/[$,]/g, "")) * 100) : line.unitCostCents,
      })),
    });
    if (!body?.ok) return;
    if (body.priceChanges?.length) setNote(`Received. Prices rippled: ${body.priceChanges.join(", ")} — every recipe using them is already repriced.`);
    else setNote("Received.");
    setOpen(body.purchase); await load();
  }

  async function reconcile(acknowledge = false) {
    if (!open) return;
    const body = await post({ action: "reconcile", id: open.id, acknowledge });
    if (body?.ok) { setNote("Reconciled."); await openPurchase(open.id); await load(); }
  }

  if (!purchases) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  // ── One purchase ─────────────────────────────────────────────────
  if (open) {
    return (
      <div className="flex flex-col gap-5 max-w-4xl">
        <PageHeader eyebrow="Purchases" title={open.vendorName}
          note={`Ordered ${dateLabel(open.orderedAt.slice(0, 10))}${open.receivedAt ? ` · received ${dateLabel(open.receivedAt.slice(0, 10))}` : ""}`}
          right={<button type="button" onClick={() => setOpen(null)} className="text-sm text-ai hover:underline">← All purchases</button>} />
        {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}
        {note && !error ? <Card className="p-4 border-l-2 border-l-state-avail"><p className="text-sm text-state-avail">{note}</p></Card> : null}

        {open.problems.length ? (
          <Card className="p-5 border-l-2 border-l-state-dining">
            <SectionHeading title="The three do not agree" note="Order vs truck vs invoice. Each difference below is real money — look before reconciling." />
            <ul className="space-y-1.5">
              {open.problems.map((problem, index) => (
                <li key={index} className="flex gap-2 text-sm text-ink-200">
                  <span className="text-state-dining shrink-0">·</span>{problemText(problem)}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th></tr></thead>
              <tbody>
                {open.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.itemName} <span className="text-ink-400 text-xs">/ {line.purchaseUnit}</span></td>
                    <td className="text-right tabular-nums">{line.qtyOrdered}</td>
                    <td className="text-right">
                      {open.status === "ordered" ? (
                        <input inputMode="decimal" className="w-20 rounded-lg bg-panel border border-border px-2 py-1.5 text-right text-sm text-ink-50 tabular-nums focus:border-ai outline-none"
                          placeholder={String(line.qtyOrdered)}
                          value={receiveEdits[line.id]?.qty ?? ""}
                          onChange={(event) => setReceiveEdits((current) => ({ ...current, [line.id]: { qty: event.target.value, cost: current[line.id]?.cost ?? "" } }))} />
                      ) : <span className="tabular-nums">{line.qtyReceived ?? "—"}</span>}
                    </td>
                    <td className="text-right">
                      {open.status === "ordered" ? (
                        <input inputMode="decimal" className="w-24 rounded-lg bg-panel border border-border px-2 py-1.5 text-right text-sm text-ink-50 tabular-nums focus:border-ai outline-none"
                          placeholder={(line.unitCostCents / 100).toFixed(2)}
                          value={receiveEdits[line.id]?.cost ?? ""}
                          onChange={(event) => setReceiveEdits((current) => ({ ...current, [line.id]: { qty: current[line.id]?.qty ?? "", cost: event.target.value } }))} />
                      ) : <span className="tabular-nums">{money(line.unitCostCents)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {open.status === "ordered" ? (
          <Card className="p-5">
            <SectionHeading title="Receive this delivery" note="Correct anything the truck disagreed with. A changed unit cost reprices the item and ripples through every recipe that uses it." />
            <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
              <Field label="Invoice number"><input className={inputClass} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></Field>
              <Field label="Invoice total" hint="Off the paper. Compared to the received lines.">
                <input className={inputClass} inputMode="decimal" placeholder="0.00" value={invoiceTotal} onChange={(event) => setInvoiceTotal(event.target.value)} />
              </Field>
            </div>
            <div className="mt-4"><Button tone="primary" disabled={busy} onClick={receive}>Mark received</Button></div>
          </Card>
        ) : null}

        {open.status === "received" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button tone="primary" disabled={busy} onClick={() => reconcile(open.problems.length > 0)}>
              {open.problems.length ? "Reconcile anyway — I have reviewed the differences" : "Reconcile"}
            </Button>
            <span className="text-xs text-ink-400">Received lines total {money(open.receivedTotalCents)}.</span>
          </div>
        ) : null}
        {open.status === "reconciled" ? <Chip tone="good">reconciled</Chip> : null}
      </div>
    );
  }

  // ── Listing + new order ──────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Purchases" title="Orders and deliveries"
        note="Order → receive → reconcile. Receiving at a new price is what keeps every recipe cost honest."
        right={<Button tone="primary" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "New order"}</Button>} />
      {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

      {creating ? (
        <Card className="p-5">
          <SectionHeading title="New order" note="Lines are priced at each item's current cost; receiving can correct them." />
          <form onSubmit={createOrder} className="flex flex-col gap-3 max-w-2xl">
            <Field label="Vendor"><input className={inputClass} value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="e.g. Sysco Denver" /></Field>
            {draftLines.map((line, index) => (
              <div key={index} className="flex gap-2">
                <select className={inputClass} value={line.itemId}
                  onChange={(event) => setDraftLines((current) => current.map((l, i) => (i === index ? { ...l, itemId: event.target.value } : l)))}>
                  <option value="">Pick an item…</option>
                  {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.purchaseUnit}, {money(item.lastCostCents)})</option>)}
                </select>
                <input inputMode="decimal" className={`${inputClass} w-24 text-right tabular-nums`} placeholder="qty" value={line.qty}
                  onChange={(event) => setDraftLines((current) => current.map((l, i) => (i === index ? { ...l, qty: event.target.value } : l)))} />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button tone="ghost" onClick={() => setDraftLines((current) => [...current, { itemId: "", qty: "" }])}>+ line</Button>
              <Button type="submit" tone="primary" disabled={busy || !vendor.trim()}>Create order</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="p-0 overflow-hidden">
        {purchases.length === 0 ? (
          <p className="p-5 text-sm text-ink-400">No purchases yet. Orders you create appear here through receiving and reconciliation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>Vendor</th><th>Ordered</th><th className="text-right">Lines</th><th>Invoice</th><th>Status</th></tr></thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr key={purchase.id} className="cursor-pointer hover:bg-panel-up/40" onClick={() => openPurchase(purchase.id)}>
                    <td className="text-ink-50">{purchase.vendorName}</td>
                    <td>{dateLabel(purchase.orderedAt.slice(0, 10))}</td>
                    <td className="text-right tabular-nums">{purchase.lineCount}</td>
                    <td>{purchase.invoiceNumber ?? "—"}</td>
                    <td><Chip tone={purchase.status === "reconciled" ? "good" : purchase.status === "received" ? "accent" : "neutral"}>{purchase.status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Price watch ── the price verification report, one location's
          worth: what we paid vs last time, who sold it, and whether the
          move broke the category cap or the contract. Trouble sorts to
          the top — the first row is the first phone call. */}
      {prices && prices.length ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <SectionHeading title="Price watch"
              note="Every item's latest received price against the previous one. A red move past its category cap is worth a look; over contract is worth a credit-memo call. Caps live under Settings." />
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>Item</th><th>Vendor</th><th className="text-right">Paid</th><th className="text-right">Previous</th><th className="text-right">Move</th><th></th></tr></thead>
              <tbody>
                {prices.slice(0, 12).map((row) => (
                  <tr key={row.itemId}>
                    <td className="text-ink-50">
                      {row.name}
                      {row.category !== "other" ? <span className="ml-2 text-xs text-ink-400">{row.category}</span> : null}
                    </td>
                    <td className="text-ink-400">{row.vendorName}</td>
                    <td className="text-right tabular-nums">
                      {money(row.paidCents)}<span className="text-xs text-ink-400">/{row.purchaseUnit}</span>
                      <span className="block text-[11px] text-ink-400">{shortDate(row.paidAt.slice(0, 10))}</span>
                    </td>
                    <td className="text-right tabular-nums">{row.previousCents != null ? money(row.previousCents) : "—"}</td>
                    <td className="text-right">
                      {row.movePct != null ? <Delta pct={row.movePct} goodWhen="down" basis={`Cap for ${row.category}: ${row.capPct}%`} /> : <span className="text-ink-400 text-sm">—</span>}
                    </td>
                    <td className="text-right">
                      <span className="inline-flex gap-1.5">
                        {row.overContract ? <Chip tone="bad">over contract</Chip> : null}
                        {row.overCap && !row.overContract ? <Chip tone="warn">past cap</Chip> : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
