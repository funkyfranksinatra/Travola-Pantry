"use client";

// app/(pantry)/history/page.tsx — every close-out on file.
//
// A plain table, on purpose. This page's job is to let someone find the
// night they typed wrong and fix it, and a chart is worse than a table
// at that. The trend lives on Today; the record lives here.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, Chip, Empty, PageHeader } from "@/components/ui";
import { money, integer, dateLabel, percent } from "@/lib/format";
import { PERIOD_LABELS, type Period } from "@/lib/shift";

type Entry = {
  id: string;
  serviceDate: string;
  period: string;
  netSalesCents: number;
  foodSalesCents: number | null;
  bevSalesCents: number | null;
  covers: number | null;
  source: string;
  notes: string | null;
  totals: { averageCheckCents: number | null; bevMixPct: number | null };
};

export default function HistoryPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shifts?list=1&limit=120")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load.");
        return body;
      })
      .then((body) => setEntries(body.entries ?? []))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <Empty>{error}</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="History"
        title="Close-outs on file"
        note="Click a night to correct it. Saving over a service replaces it — it never adds a second row."
      />

      {!entries ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : entries.length === 0 ? (
        <Card className="p-5">
          <Empty>
            No close-outs yet. <Link href="/close-out" className="text-ai hover:underline">Close out a service →</Link>
          </Empty>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="text-right">Net sales</th>
                  <th className="text-right">Covers</th>
                  <th className="text-right">Avg check</th>
                  <th className="text-right">Bev mix</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Link href={`/close-out?date=${entry.serviceDate}`} className="text-ink-50 hover:text-ai">
                        {dateLabel(entry.serviceDate)}
                      </Link>
                      {entry.period !== "all_day" ? (
                        <span className="ml-2 text-xs text-ink-400">
                          {PERIOD_LABELS[entry.period as Period] ?? entry.period}
                        </span>
                      ) : null}
                      {entry.source !== "manual" ? (
                        <span className="ml-2"><Chip tone="accent">{entry.source}</Chip></span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{money(entry.netSalesCents)}</td>
                    <td className="text-right tabular-nums">{entry.covers == null ? "—" : integer(entry.covers)}</td>
                    <td className="text-right tabular-nums">
                      {entry.totals.averageCheckCents == null ? "—" : money(entry.totals.averageCheckCents)}
                    </td>
                    <td className="text-right tabular-nums">
                      {entry.totals.bevMixPct == null ? "—" : percent(entry.totals.bevMixPct)}
                    </td>
                    <td className="text-ink-400 max-w-[28ch] truncate" title={entry.notes ?? ""}>
                      {entry.notes ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
