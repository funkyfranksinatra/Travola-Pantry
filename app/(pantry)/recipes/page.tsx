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
import { Button, Card, Chip, Empty, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { money, percent, dateLabel } from "@/lib/format";

type Dish = {
  menuItemId: string; name: string; category: string; priceCents: number;
  recipeId: string | null;
  lines: Array<{ itemId: string; itemName: string; quantity: number; usageUnit: string }>;
  plateCostCents: number | null; marginPct: number | null; costPct: number | null;
};
type Item = { id: string; name: string; usageUnit: string };
type VarianceRow = {
  itemId: string; itemName: string; roomName: string; countUnit: string;
  actualUsageCount: number | null; theoreticalUsageCount: number | null;
  wasteCount: number; varianceCount: number | null; varianceValueCents: number | null;
  hasRecipeUsage: boolean;
};
type VarianceData = {
  ready: boolean; reason?: string; salesNote?: string; hasSalesData?: boolean;
  window?: { from: string; to: string; openId: string; closeId: string };
  counts: Array<{ id: string; approvedAt: string; type: string; countedBy: string; totalValueCents: number; lineCount: number }>;
  totals?: { openingValueCents: number; closingValueCents: number; varianceValueCents: number };
  rows?: VarianceRow[];
};

export default function RecipesPage() {
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [variance, setVariance] = useState<VarianceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Dish | null>(null);
  const [draft, setDraft] = useState<Array<{ itemId: string; quantity: string }>>([]);

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

  if (!dishes) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  const mapped = dishes.filter((dish) => dish.recipeId);
  const rows = variance?.rows ?? [];

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

      {/* ── AvT ── */}
      <Card className="p-5">
        <SectionHeading title="Actual vs theoretical"
          note="Actual usage from the counts and deliveries; theoretical from recipes × items sold. The gap is over-portioning, waste, breakage or theft — visible now, not in a month-end P&L." />
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
                <thead><tr><th>Item</th><th>Room</th><th className="text-right">Actual used</th><th className="text-right">Theoretical</th><th className="text-right">Waste logged</th><th className="text-right">Variance</th><th className="text-right">$ impact</th></tr></thead>
                <tbody>
                  {rows.slice(0, 25).map((row) => (
                    <tr key={row.itemId}>
                      <td className="text-ink-50">{row.itemName}</td>
                      <td className="text-ink-400">{row.roomName}</td>
                      <td className="text-right tabular-nums">{row.actualUsageCount != null ? `${row.actualUsageCount.toFixed(1)} ${row.countUnit}` : "—"}</td>
                      <td className="text-right tabular-nums">{row.theoreticalUsageCount != null ? `${row.theoreticalUsageCount.toFixed(1)} ${row.countUnit}` : "—"}</td>
                      <td className="text-right tabular-nums">{row.wasteCount ? row.wasteCount.toFixed(1) : "—"}</td>
                      <td className="text-right tabular-nums">
                        {row.varianceCount == null ? "—" : (
                          <span className={Math.abs(row.varianceValueCents ?? 0) >= 500 ? "text-state-seated font-semibold" : ""}>
                            {row.varianceCount > 0 ? "+" : ""}{row.varianceCount.toFixed(1)} {row.countUnit}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{row.varianceValueCents != null ? money(row.varianceValueCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
