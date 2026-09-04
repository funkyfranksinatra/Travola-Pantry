"use client";

// app/(pantry)/recipes/page.tsx — recipe mapping, live plate costs,
// and the AvT variance report.
//
// One tab for both because they are one system: recipes turn sales
// into theoretical usage, and variance is the gap between that and
// the counts. Costs on this page are computed at read time from each
// ingredient's latest invoice price — change the price of oil and
// every dish that uses oil is already repriced when this page loads.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Chip, Empty, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { money, percent, dateLabel } from "@/lib/format";

type Dish = {
  menuItemId: string; name: string; category: string; priceCents: number;
  recipeId: string | null;
  lines: Array<{ itemId: string; itemName: string; quantity: number; usageUnit: string }>;
  plateCostCents: number | null; marginPct: number | null; costPct: number | null;
};
type Item = { id: string; name: string; usageUnit: string };
type VarianceRow = {
  itemId: string; itemName: string; roomName: string; countUnit: string; category: string;
  actualUsageCount: number | null; theoreticalUsageCount: number | null;
  wasteCount: number; wasteValueCents: number; varianceCount: number | null; varianceValueCents: number | null;
  actualValueCents: number | null; sharePct: number | null;
  hasRecipeUsage: boolean;
};
type VarianceData = {
  ready: boolean; reason?: string; salesNote?: string; hasSalesData?: boolean;
  window?: { from: string; to: string; openId: string; closeId: string };
  counts: Array<{ id: string; approvedAt: string; type: string; countedBy: string; totalValueCents: number; lineCount: number }>;
  totals?: {
    openingValueCents: number; closingValueCents: number; varianceValueCents: number;
    actualUsageValueCents: number; wasteValueCents: number; salesCents: number; cogsPct: number | null;
  };
  rows?: VarianceRow[];
};
type Drill = {
  itemId: string; itemName: string; countUnit: string; usageUnit: string; purchaseUnit: string;
  opening: { quantity: number; at: string; valueCents: number } | null;
  closing: { quantity: number; at: string; valueCents: number } | null;
  purchases: Array<{ purchaseId: string; vendorName: string; receivedAt: string; qty: number; unitCostCents: number }>;
  waste: Array<{ quantity: number; reason: string; valueCents: number; note: string | null; recordedBy: string; occurredAt: string }>;
  dishes: Array<{ dishName: string; sold: number; perUnit: number; usage: number }>;
};

export default function RecipesPage() {
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [variance, setVariance] = useState<VarianceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Dish | null>(null);
  const [draft, setDraft] = useState<Array<{ itemId: string; quantity: string }>>([]);
  // Drill-through: which variance row is open, and its detail once
  // fetched. Cached per item so re-opening a row is instant.
  const [drillOpen, setDrillOpen] = useState<string | null>(null);
  const [drills, setDrills] = useState<Record<string, Drill | "loading">>({});

  const load = useCallback(async (open?: string, close?: string) => {
    const query = open && close ? `?open=${open}&close=${close}` : "";
    const [recipesRes, itemsRes, varianceRes] = await Promise.all([
      fetch("/api/recipes"), fetch("/api/items"), fetch(`/api/variance${query}`),
    ]);
    const [recipesBody, itemsBody, varianceBody] = await Promise.all([recipesRes.json(), itemsRes.json(), varianceRes.json()]);
    if (!recipesRes.ok) { setError(recipesBody.error ?? "Could not load."); return; }
    setDishes(recipesBody.dishes);
    setItems((itemsBody.items ?? []).map((item: Item) => ({ id: item.id, name: item.name, usageUnit: item.usageUnit })));
    setVariance(varianceBody);
  }, []);
  useEffect(() => { load(); }, [load]);

  function openEditor(dish: Dish) {
    setEditing(dish);
    setDraft(dish.lines.length ? dish.lines.map((line) => ({ itemId: line.itemId, quantity: String(line.quantity) })) : [{ itemId: "", quantity: "" }]);
  }

  async function saveRecipe(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/recipes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save", menuItemId: editing.menuItemId,
          lines: draft.filter((line) => line.itemId && Number(line.quantity) > 0).map((line) => ({ itemId: line.itemId, quantity: Number(line.quantity) })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save.");
      setEditing(null);
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleDrill(itemId: string) {
    if (drillOpen === itemId) { setDrillOpen(null); return; }
    setDrillOpen(itemId);
    if (drills[itemId] || !variance?.window) return;
    setDrills((current) => ({ ...current, [itemId]: "loading" }));
    const response = await fetch(`/api/variance?open=${variance.window.openId}&close=${variance.window.closeId}&item=${itemId}`);
    const body = await response.json();
    if (response.ok && body.drill) setDrills((current) => ({ ...current, [itemId]: body.drill }));
  }

  if (!dishes) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  const mapped = dishes.filter((dish) => dish.recipeId);
  const rows = variance?.rows ?? [];
  const totals = variance?.totals;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Recipes" title="Recipes and variance"
        note="A recipe turns a sale into theoretical usage and an invoice into a plate cost. Variance is where the two meet the physical count." />
      {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

      {/* ── Recipe editor ── */}
      {editing ? (
        <Card className="p-5 border-l-2 border-l-ai">
          <SectionHeading title={`Recipe: ${editing.name}`} note="Quantities are in each ingredient's usage unit. Saving with no lines removes the recipe." />
          <form onSubmit={saveRecipe} className="flex flex-col gap-3 max-w-2xl">
            {draft.map((line, index) => {
              const unit = items.find((item) => item.id === line.itemId)?.usageUnit ?? "";
              return (
                <div key={index} className="flex gap-2 items-center">
                  <select className={inputClass} value={line.itemId}
                    onChange={(event) => setDraft((current) => current.map((l, i) => (i === index ? { ...l, itemId: event.target.value } : l)))}>
                    <option value="">Pick an ingredient…</option>
                    {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <input inputMode="decimal" className={`${inputClass} w-24 text-right tabular-nums`} placeholder="qty" value={line.quantity}
                    onChange={(event) => setDraft((current) => current.map((l, i) => (i === index ? { ...l, quantity: event.target.value } : l)))} />
                  <span className="text-xs text-ink-400 w-10 shrink-0">{unit}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-3">
              <Button tone="ghost" onClick={() => setDraft((current) => [...current, { itemId: "", quantity: "" }])}>+ ingredient</Button>
              <Button type="submit" tone="primary" disabled={busy}>Save recipe</Button>
              <Button tone="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {/* ── Dishes ── */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <SectionHeading title="Menu" note={`${mapped.length} of ${dishes.length} dishes have recipes. Start with the top sellers — twenty recipes cover most of the food cost.`} />
        </div>
        <div className="overflow-x-auto">
          <table className="data-table w-full">
            <thead><tr><th>Dish</th><th className="text-right">Menu price</th><th className="text-right">Plate cost</th><th className="text-right">Cost %</th><th className="text-right">Margin</th><th></th></tr></thead>
            <tbody>
              {dishes.map((dish) => (
                <tr key={dish.menuItemId}>
                  <td className="text-ink-50">{dish.name}{dish.category ? <span className="ml-2 text-xs text-ink-400">{dish.category}</span> : null}</td>
                  <td className="text-right tabular-nums">{dish.priceCents ? money(dish.priceCents) : "—"}</td>
                  <td className="text-right tabular-nums">{dish.plateCostCents != null ? money(dish.plateCostCents) : "—"}</td>
                  <td className="text-right tabular-nums">{dish.costPct != null ? percent(dish.costPct) : "—"}</td>
                  <td className="text-right tabular-nums">{dish.marginPct != null ? percent(dish.marginPct) : "—"}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => openEditor(dish)} className="text-sm text-ai hover:underline">
                      {dish.recipeId ? "Edit" : "Add recipe"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── The headline numbers ── the window's food cost, against
          sales, split into explained and unexplained. These four tiles
          are the report; the table below is where to go hunting. */}
      {variance?.ready && totals ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Food cost — this window"
            value={money(totals.actualUsageValueCents)}
            hint="Opening + deliveries − closing, priced at cost."
          />
          <StatTile
            label="Food cost % of sales"
            value={totals.cogsPct != null ? percent(totals.cogsPct) : "—"}
            hint={totals.salesCents > 0
              ? `Against ${money(totals.salesCents)} net sales in the window.`
              : "No sales recorded inside this window yet — close out services or connect the POS."}
          />
          <StatTile
            label="Explained by waste"
            value={money(totals.wasteValueCents)}
            hint="Logged waste at cost — variance with a reason attached."
          />
          <StatTile
            label="Unexplained variance (net)"
            value={money(totals.varianceValueCents)}
            hint="Actual − theoretical − logged waste. Offsetting errors cancel here — the rows below are where they cannot hide."
            footnote={`Gross swing ${money(rows.reduce((sum, row) => sum + Math.abs(row.varianceValueCents ?? 0), 0))} across items.`}
          />
        </section>
      ) : null}

      {/* ── AvT ── */}
      <Card className="p-5">
        <SectionHeading title="Actual vs theoretical"
          note="Actual usage from the counts and deliveries; theoretical from recipes × items sold. The gap is over-portioning, waste, breakage or theft — visible now, not in a month-end P&L. Click any row to open its full equation." />
        {!variance?.ready ? (
          <Empty>{variance?.reason ?? "Loading…"}</Empty>
        ) : (
          <>
            <p className="text-sm text-ink-400 mb-1">
              Window: {dateLabel(String(variance.window!.from).slice(0, 10))} → {dateLabel(String(variance.window!.to).slice(0, 10))}
              {" · "}on hand {money(variance.totals!.openingValueCents)} → {money(variance.totals!.closingValueCents)}
            </p>
            {variance.salesNote ? (
              <p className="mb-3 rounded-lg bg-panel-up/50 border border-border px-3.5 py-2.5 text-sm text-ink-200">{variance.salesNote}</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead><tr><th>Item</th><th>Room</th><th className="text-right">Actual used</th><th className="text-right">Theoretical</th><th className="text-right">Waste logged</th><th className="text-right">Variance</th><th className="text-right">$ impact</th><th className="text-right" title="Share of the window's total usage dollars — the cost breakout.">% of usage</th></tr></thead>
                <tbody>
                  {rows.slice(0, 25).map((row) => {
                    const open = drillOpen === row.itemId;
                    const drill = drills[row.itemId];
                    return (
                      <RowWithDrill key={row.itemId} row={row} open={open} drill={drill} onToggle={() => toggleDrill(row.itemId)} />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** One variance row plus, when opened, its full equation: the counts
 *  that bookend it, every delivery, the waste log, and dish-by-dish
 *  sales. R365 calls this drill-through; here nobody even leaves the
 *  table. */
function RowWithDrill({ row, open, drill, onToggle }: {
  row: VarianceRow; open: boolean; drill: Drill | "loading" | undefined; onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-panel-up/40" aria-expanded={open}>
        <td className="text-ink-50">
          <span className={`inline-block mr-1.5 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">›</span>
          {row.itemName}
          {row.category !== "other" ? <span className="ml-2 text-xs text-ink-400">{row.category}</span> : null}
        </td>
        <td className="text-ink-400">{row.roomName}</td>
        <td className="text-right tabular-nums">{row.actualUsageCount != null ? `${row.actualUsageCount.toFixed(1)} ${row.countUnit}` : "—"}</td>
        <td className="text-right tabular-nums">{row.theoreticalUsageCount != null ? `${row.theoreticalUsageCount.toFixed(1)} ${row.countUnit}` : "—"}</td>
        <td className="text-right tabular-nums">{row.wasteCount ? `${row.wasteCount.toFixed(1)} · ${money(row.wasteValueCents)}` : "—"}</td>
        <td className="text-right tabular-nums">
          {row.varianceCount == null ? "—" : (
            <span className={Math.abs(row.varianceValueCents ?? 0) >= 500 ? "text-state-seated font-semibold" : ""}>
              {row.varianceCount > 0 ? "+" : ""}{row.varianceCount.toFixed(1)} {row.countUnit}
            </span>
          )}
        </td>
        <td className="text-right tabular-nums">{row.varianceValueCents != null ? money(row.varianceValueCents) : "—"}</td>
        <td className="text-right tabular-nums">{row.sharePct != null ? percent(row.sharePct) : "—"}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="!p-0">
            <div className="bg-panel-up/25 border-y border-border px-5 py-4">
              {drill === "loading" || !drill ? (
                <p className="text-sm text-ink-400">Opening the equation…</p>
              ) : (
                <div className="grid gap-5 lg:grid-cols-3 text-sm">
                  <div>
                    <p className="label mb-2">The actual side</p>
                    <ul className="space-y-1.5 text-ink-200">
                      <li className="flex justify-between gap-3">
                        <span>Opening count{drill.opening ? ` · ${dateLabel(String(drill.opening.at).slice(0, 10))}` : ""}</span>
                        <span className="tabular-nums">{drill.opening ? `${drill.opening.quantity.toFixed(1)} ${drill.countUnit}` : "not counted"}</span>
                      </li>
                      {drill.purchases.map((purchase, index) => (
                        <li key={index} className="flex justify-between gap-3">
                          <Link href={`/purchases?id=${purchase.purchaseId}`} className="text-ai hover:underline truncate">
                            + {purchase.vendorName} · {dateLabel(String(purchase.receivedAt).slice(0, 10))}
                          </Link>
                          <span className="tabular-nums shrink-0">{purchase.qty} {drill.purchaseUnit} @ {money(purchase.unitCostCents)}</span>
                        </li>
                      ))}
                      {!drill.purchases.length ? <li className="text-ink-400">No deliveries in the window.</li> : null}
                      <li className="flex justify-between gap-3 border-t border-border pt-1.5">
                        <span>− Closing count{drill.closing ? ` · ${dateLabel(String(drill.closing.at).slice(0, 10))}` : ""}</span>
                        <span className="tabular-nums">{drill.closing ? `${drill.closing.quantity.toFixed(1)} ${drill.countUnit}` : "not counted"}</span>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <p className="label mb-2">The theoretical side</p>
                    {drill.dishes.length ? (
                      <ul className="space-y-1.5 text-ink-200">
                        {drill.dishes.map((dish, index) => (
                          <li key={index} className="flex justify-between gap-3">
                            <span className="truncate">{dish.dishName} × {dish.sold}</span>
                            <span className="tabular-nums shrink-0">{dish.usage.toFixed(1)} {drill.usageUnit}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-ink-400">No dish in the window's sales uses this item — theoretical usage is unknowable for it, so nothing is being claimed.</p>
                    )}
                  </div>
                  <div>
                    <p className="label mb-2">Waste log</p>
                    {drill.waste.length ? (
                      <ul className="space-y-1.5 text-ink-200">
                        {drill.waste.map((event, index) => (
                          <li key={index} className="flex justify-between gap-3">
                            <span className="truncate">{dateLabel(String(event.occurredAt).slice(0, 10))} · {event.reason.replace("_", " ")}{event.note ? ` — ${event.note}` : ""}</span>
                            <span className="tabular-nums shrink-0">{event.quantity.toFixed(1)} {drill.countUnit} · {money(event.valueCents)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-ink-400">Nothing logged. Unlogged waste is what this variance number cannot explain.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
