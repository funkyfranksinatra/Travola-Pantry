"use client";

// app/(pantry)/page.tsx — Today.
//
// The landing page, and the answer to "what do I need to do right now".
// At this stage that is one thing — close out the nights that have not
// been closed — so the page says one thing loudly rather than five
// things quietly.
//
// The missing-nights list is the whole feature. A close-out that is a
// day late is fine; a close-out that is a fortnight late will never
// happen, and the gap silently becomes a hole in every average on the
// analysis tab. Naming the specific dates is what gets them filled.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Chip, Empty, PageHeader, SectionHeading } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { money, integer, shortDate } from "@/lib/format";
import { PERIOD_LABELS, dateKey, likelyServiceDate, type Period } from "@/lib/shift";

type Entry = {
  serviceDate: string;
  period: string;
  netSalesCents: number;
  covers: number | null;
  notes: string | null;
  totals: { averageCheckCents: number | null; bevMixPct: number | null };
};

/** The last 14 service dates, newest first. Deliberately calendar days
 *  rather than "days the restaurant was open" — Pantry does not know the
 *  opening days yet, and guessing wrong would nag someone about a
 *  Monday they are closed. The copy says "not closed out" rather than
 *  "missing" for exactly that reason. */
function recentDays(count = 14) {
  const out: string[] = [];
  const start = new Date(`${likelyServiceDate(new Date())}T12:00:00Z`);
  for (let i = 0; i < count; i += 1) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - i);
    out.push(dateKey(day));
  }
  return out;
}

export default function TodayPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shifts?list=1&limit=60")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load.");
        return body;
      })
      .then((body) => setEntries(body.entries ?? []))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!entries) return <p className="text-sm text-ink-400">Loading…</p>;

  const closed = new Set(entries.map((entry) => entry.serviceDate));
  const open = recentDays().filter((day) => !closed.has(day));
  const last14 = entries.slice(0, 14);
  const salesTotal = last14.reduce((sum, entry) => sum + entry.netSalesCents, 0);
  const coversTotal = last14.reduce((sum, entry) => sum + (entry.covers ?? 0), 0);
  const avgCheck = coversTotal > 0 ? Math.round(salesTotal / coversTotal) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Today"
        title="Pantry"
        note="Inventory lives here. For now it records what each service took, so the analysis tab has revenue to work with."
        right={
          <Link
            href="/close-out"
            className="rounded-lg bg-ai text-bg font-semibold px-4 py-2.5 text-sm hover:opacity-90"
          >
            Close out a service
          </Link>
        }
      />

      {/* ── The one thing that needs doing ── */}
      <Card className={`p-5 ${open.length ? "border-l-2 border-l-state-dining" : ""}`}>
        <SectionHeading
          title={open.length ? "Not closed out yet" : "Nothing outstanding"}
          note={
            open.length
              ? "A close-out a day late is fine. A fortnight late never happens, and the gap becomes a hole in every average."
              : "Every night in the last fortnight has a close-out on file."
          }
        />
        {open.length ? (
          <div className="flex flex-wrap gap-2">
            {open.map((day) => (
              <Link
                key={day}
                href={`/close-out?date=${day}`}
                className="rounded-lg border border-border bg-panel-up/40 px-3 py-2 text-sm text-ink-50 hover:border-ai/40 hover:bg-panel-up transition-colors"
              >
                {shortDate(day)}
              </Link>
            ))}
          </div>
        ) : null}
      </Card>

      {/* ── What the close-outs add up to ── */}
      {last14.length ? (
        <section>
          <div className="flex items-baseline justify-between gap-4 mb-3">
            <h2 className="text-lg font-semibold text-ink-50 tracking-tight">
              {last14.length === 1 ? "Last service" : `Last ${last14.length} services`}
            </h2>
            <Link href="/history" className="text-sm text-ai hover:underline">All close-outs →</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Net sales" value={money(salesTotal)} hint="Sum of the close-outs on file." />
            <StatTile label="Covers" value={coversTotal ? integer(coversTotal) : "—"} hint="As entered at close-out." />
            <StatTile
              label="Average check"
              value={avgCheck ? money(avgCheck) : "—"}
              hint={coversTotal ? "Net sales ÷ covers." : "Enter covers to see this."}
            />
          </div>
        </section>
      ) : (
        <Card className="p-5">
          <SectionHeading title="Nothing on file yet" note="" />
          <p className="text-sm text-ink-400 max-w-2xl">
            Close out one service and this page starts showing what the restaurant is taking. Two weeks of
            close-outs is enough for the analysis tab in Travola Home to show revenue, average bill and
            growth again.
          </p>
        </Card>
      )}

      {/* ── What is built now ── */}
      <Card className="p-5">
        <SectionHeading
          title="Inventory"
          note="Rooms, counts, purchases, recipes and variance are live. What remains shelved is listed under Settings, honestly."
        />
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            ["Inventory", "/inventory", "The storage map — rooms laid out as the building is, items in shelf order."],
            ["Count", "/count", "Phone-first counting in shelf order; staff submit, a manager approves."],
            ["Purchases", "/purchases", "Order → receive → reconcile, with the three-way match and price rippling."],
            ["Recipes", "/recipes", "Plate costs from live ingredient prices, and actual-vs-theoretical variance."],
          ].map(([title, href, detail]) => (
            <li key={title}>
              <Link href={href} className="block rounded-xl border border-border bg-panel-up/30 px-4 py-3 hover:border-ai/40 hover:bg-panel-up transition-colors">
                <span className="text-sm font-semibold text-ink-50">{title} →</span>
                <span className="block text-xs text-ink-400 mt-1.5 leading-relaxed">{detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
