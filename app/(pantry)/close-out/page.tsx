"use client";

// app/(pantry)/close-out/page.tsx — the sixty-second form.
//
// Its length is a HARD BUDGET, not a target. Every field added is a
// night somebody skips it, and a close-out that gets skipped costs more
// than the field was ever worth. So: one required number, three that
// pay for themselves, and everything else folded away behind "More".
//
// It is used at 1am by someone who has been standing for fourteen hours
// and is holding a POS printout. That is the design constraint for every
// decision on this page — big targets, numeric keyboards, no hunting,
// and a service date that defaults to the night they just worked rather
// than to the calendar day the clock has already rolled into.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { money as fmtMoney, integer } from "@/lib/format";
import {
  PERIODS,
  PERIOD_LABELS,
  likelyServiceDate,
  parseHoursToMinutes,
  parseMoneyToCents,
  validateShift,
  type Period,
} from "@/lib/shift";

type Entry = {
  id: string;
  serviceDate: string;
  period: string;
  netSalesCents: number;
  foodSalesCents: number | null;
  bevSalesCents: number | null;
  compsCents: number;
  discountsCents: number;
  covers: number | null;
  laborMinutes: number | null;
  laborCostCents: number | null;
  source: string;
  notes: string | null;
  totals: {
    averageCheckCents: number | null;
    salesPerLaborHourCents: number | null;
    laborPctOfSales: number | null;
    bevMixPct: number | null;
  };
};

/** Everything is held as the STRING the user typed, and parsed only on
 *  the way out. Parsing on every keystroke fights the person entering
 *  "1240.50" by mangling it at "1240." */
type Form = {
  netSales: string;
  foodSales: string;
  bevSales: string;
  comps: string;
  discounts: string;
  covers: string;
  laborHours: string;
  laborCost: string;
  notes: string;
};

const EMPTY: Form = {
  netSales: "", foodSales: "", bevSales: "", comps: "",
  discounts: "", covers: "", laborHours: "", laborCost: "", notes: "",
};

const toInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2);

export default function CloseOutPage() {
  const [serviceDate, setServiceDate] = useState(() => likelyServiceDate(new Date()));
  const [period, setPeriod] = useState<Period>("all_day");
  const [form, setForm] = useState<Form>(EMPTY);
  const [booked, setBooked] = useState<number | null>(null);
  const [existing, setExisting] = useState<Entry | null>(null);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const load = useCallback(async (day: string, which: Period) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/shifts?date=${day}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load.");
      setBooked(body.bookedCovers ?? null);
      const match: Entry | undefined = (body.entries ?? []).find((e: Entry) => e.period === which);
      setExisting(match ?? null);
      if (match) {
        // Editing an existing close-out: show what is on file rather
        // than an empty form beside a "already closed" warning.
        setForm({
          netSales: toInput(match.netSalesCents),
          foodSales: toInput(match.foodSalesCents),
          bevSales: toInput(match.bevSalesCents),
          comps: match.compsCents ? toInput(match.compsCents) : "",
          discounts: match.discountsCents ? toInput(match.discountsCents) : "",
          covers: match.covers == null ? "" : String(match.covers),
          laborHours: match.laborMinutes == null ? "" : (match.laborMinutes / 60).toFixed(2).replace(/\.00$/, ""),
          laborCost: toInput(match.laborCostCents),
          notes: match.notes ?? "",
        });
        setMore(Boolean(match.compsCents || match.discountsCents || match.laborMinutes || match.laborCostCents));
      } else {
        setForm(EMPTY);
        setMore(false);
      }
      setErrors({});
      setBanner(null);
    } catch (err) {
      setBanner((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(serviceDate, period);
  }, [serviceDate, period, load]);

  const draft = () => ({
    serviceDate,
    period,
    netSalesCents: parseMoneyToCents(form.netSales),
    foodSalesCents: parseMoneyToCents(form.foodSales),
    bevSalesCents: parseMoneyToCents(form.bevSales),
    compsCents: parseMoneyToCents(form.comps) ?? 0,
    discountsCents: parseMoneyToCents(form.discounts) ?? 0,
    covers: form.covers.trim() === "" ? null : Number(form.covers),
    laborMinutes: parseHoursToMinutes(form.laborHours),
    laborCostCents: parseMoneyToCents(form.laborCost),
    notes: form.notes.trim() || null,
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = draft();
    const problems = validateShift(payload);
    if (problems.length) {
      setErrors(Object.fromEntries(problems.map((p) => [p.field, p.message])));
      setBanner(problems[0].message);
      return;
    }
    setBusy(true);
    setErrors({});
    setBanner(null);
    try {
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.fields) setErrors(Object.fromEntries(body.fields.map((f: { field: string; message: string }) => [f.field, f.message])));
        throw new Error(body.error ?? "That did not save.");
      }
      setExisting(body.entry);
      setSaved(body.corrected ? "Close-out corrected." : "Close-out saved.");
      setTimeout(() => setSaved(null), 4000);
    } catch (err) {
      setBanner((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // The live read-back. This is what stops a decimal slip becoming a
  // month of wrong averages: the owner sees "$62.03 average check" and
  // knows instantly whether it is their restaurant or a typo.
  const netCents = parseMoneyToCents(form.netSales);
  const coversNow = form.covers.trim() === "" ? booked : Number(form.covers);
  const preview =
    typeof netCents === "number" && !Number.isNaN(netCents) && coversNow && coversNow > 0
      ? Math.round(netCents / coversNow)
      : null;

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
      <PageHeader
        eyebrow="Close-out"
        title="How did tonight go?"
        note="Net sales is the only number this needs. Everything else makes the reports better, and can wait."
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* ── When ── */}
        <Card className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Service date"
              hint="Defaults to the night you just worked, not the date on the clock."
              error={errors.serviceDate}
            >
              <input
                type="date"
                className={inputClass}
                value={serviceDate}
                max={likelyServiceDate(new Date(), 0)}
                onChange={(event) => setServiceDate(event.target.value)}
              />
            </Field>
            <Field label="Service" hint="Only split this if you run lunch and dinner as separate books.">
              <div className="flex flex-wrap gap-2">
                {PERIODS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPeriod(option)}
                    aria-pressed={period === option}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold border ${
                      period === option
                        ? "bg-ai-bg border-ai/40 text-ai"
                        : "bg-panel border-border text-ink-400 hover:text-ink-50"
                    }`}
                  >
                    {PERIOD_LABELS[option]}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {existing ? (
            <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-400">
              <Chip tone="accent">already closed</Chip>
              This service was closed out at {fmtMoney(existing.netSalesCents)}. Saving again corrects it —
              it never creates a second row.
            </p>
          ) : null}
        </Card>

        {/* ── The money ── */}
        <Card className="p-5">
          <SectionHeading title="Sales" note="Net of tax, gross of tip — the figure your card reader calls net sales." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Net sales" hint="Required." error={errors.netSalesCents}>
              <input
                className={`${inputClass} text-lg font-semibold tabular-nums`}
                inputMode="decimal"
                autoFocus
                placeholder="0.00"
                value={form.netSales}
                onChange={(event) => set("netSales", event.target.value)}
              />
            </Field>
            <Field label="Food" hint="Optional, but it is what separates food cost from pour cost." error={errors.foodSalesCents}>
              <input
                className={`${inputClass} tabular-nums`}
                inputMode="decimal"
                placeholder="0.00"
                value={form.foodSales}
                onChange={(event) => set("foodSales", event.target.value)}
              />
            </Field>
            <Field label="Beverage" hint="Optional." error={errors.bevSalesCents}>
              <input
                className={`${inputClass} tabular-nums`}
                inputMode="decimal"
                placeholder="0.00"
                value={form.bevSales}
                onChange={(event) => set("bevSales", event.target.value)}
              />
            </Field>
          </div>
        </Card>

        {/* ── Covers ── */}
        <Card className="p-5">
          <SectionHeading
            title="Covers"
            note="The floor manager already counted what was on the book. Correct it for walk-ins and no-shows."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Covers served"
              hint={booked == null ? "" : `${integer(booked)} on the book for this date.`}
              error={errors.covers}
            >
              <input
                className={`${inputClass} tabular-nums`}
                inputMode="numeric"
                placeholder={booked == null ? "0" : String(booked)}
                value={form.covers}
                onChange={(event) => set("covers", event.target.value)}
              />
            </Field>
            {preview ? (
              <div className="flex flex-col justify-end pb-1">
                <span className="label">Average check</span>
                <span className="figure-sm text-ink-50 mt-1.5 tabular-nums">{fmtMoney(preview)}</span>
                <span className="text-xs text-ink-400 mt-1">
                  {form.covers.trim() === "" ? "Using the booked count." : "Using the count you entered."}
                </span>
              </div>
            ) : null}
          </div>
        </Card>

        {/* ── Everything else, folded away ── */}
        <Card className="p-5">
          <button
            type="button"
            onClick={() => setMore((value) => !value)}
            className="flex w-full items-center justify-between gap-4 text-left"
          >
            <span>
              <span className="block text-base font-semibold text-ink-50">More detail</span>
              <span className="block text-sm text-ink-400 mt-0.5">
                Comps, discounts and labour. Labour is what unlocks prime cost.
              </span>
            </span>
            <span className="text-ai shrink-0 text-sm">{more ? "Hide" : "Show"}</span>
          </button>

          {more ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Comps" hint="Explains variance that otherwise reads as theft." error={errors.compsCents}>
                <input className={`${inputClass} tabular-nums`} inputMode="decimal" placeholder="0.00"
                  value={form.comps} onChange={(event) => set("comps", event.target.value)} />
              </Field>
              <Field label="Discounts" hint="" error={errors.discountsCents}>
                <input className={`${inputClass} tabular-nums`} inputMode="decimal" placeholder="0.00"
                  value={form.discounts} onChange={(event) => set("discounts", event.target.value)} />
              </Field>
              <Field label="Labour hours" hint="7.5 or 7:30 — both work." error={errors.laborMinutes}>
                <input className={`${inputClass} tabular-nums`} inputMode="decimal" placeholder="0"
                  value={form.laborHours} onChange={(event) => set("laborHours", event.target.value)} />
              </Field>
              <Field label="Labour cost" hint="With hours, this gives you prime cost." error={errors.laborCostCents}>
                <input className={`${inputClass} tabular-nums`} inputMode="decimal" placeholder="0.00"
                  value={form.laborCost} onChange={(event) => set("laborCost", event.target.value)} />
              </Field>
            </div>
          ) : null}
        </Card>

        {/* ── The note ── */}
        <Card className="p-5">
          <SectionHeading
            title="Anything unusual?"
            note="Power cut, an 80-top that walked in, a snowstorm. This is what turns a forecast miss from a mystery into an explanation."
          />
          <input
            className={inputClass}
            maxLength={1000}
            placeholder="e.g. Power out 7–8pm, kitchen on the generator"
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {banner ? <p className="text-sm text-state-seated">{banner}</p> : null}
            {saved && !banner ? <p className="text-sm text-state-avail">{saved}</p> : null}
          </div>
          <Button type="submit" tone="primary" disabled={busy || loading}>
            {busy ? "Saving…" : existing ? "Correct the close-out" : "Save close-out"}
          </Button>
        </div>
      </form>
    </div>
  );
}
