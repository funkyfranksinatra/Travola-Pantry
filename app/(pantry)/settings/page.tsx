"use client";

// app/(pantry)/settings/page.tsx — Pantry's own settings.
//
// Small on purpose: the shared restaurant settings (hours, days, name)
// live in Travola Home and are not duplicated here — two screens
// editing one row is how the row ends up wrong. What lives here is
// what only Pantry owns: the room layout, the price-move caps, and
// honest notes on what is not built yet.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, PageHeader, SectionHeading } from "@/components/ui";
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, DEFAULT_PRICE_CAP_PCT, type ItemCategory } from "@/lib/inventory";

export default function SettingsPage() {
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [capsError, setCapsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/caps")
      .then((response) => response.json())
      .then((body) => {
        const loaded: Record<string, number> = {};
        for (const cap of body.caps ?? []) loaded[cap.category] = cap.capPct;
        setSaved(loaded);
        setCaps(Object.fromEntries(Object.entries(loaded).map(([k, v]) => [k, String(v)])));
      })
      .catch(() => setCapsError("Could not load the caps."));
  }, []);

  async function saveCap(category: string) {
    const raw = (caps[category] ?? "").trim();
    const hadSaved = saved[category] != null;
    setBusy(true); setCapsError(null);
    try {
      if (raw === "") {
        if (!hadSaved) return; // blank and never saved — nothing to do
        const response = await fetch("/api/caps", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "remove", category }),
        });
        if (!response.ok) throw new Error((await response.json()).error);
        setSaved((current) => { const next = { ...current }; delete next[category]; return next; });
        return;
      }
      const capPct = Number(raw);
      if (!Number.isFinite(capPct) || capPct <= 0) { setCapsError("A cap is a percentage above zero."); return; }
      if (capPct === saved[category]) return;
      const response = await fetch("/api/caps", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", category, capPct }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setSaved((current) => ({ ...current, [category]: capPct }));
    } catch (err) { setCapsError((err as Error).message || "Could not save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <PageHeader eyebrow="Settings" title="Pantry settings"
        note="Hours, days open and the restaurant name live in Travola Home — one place edits them for all three apps." />

      <Card className="p-5">
        <SectionHeading title="Inventory rooms"
          note="The storage map mirrors the building so counting can follow the shelves. Edit mode works like the floor manager's room editor: add rooms, drag them where they sit, resize from the corner." />
        <Link href="/inventory?edit=1"
          className="inline-flex items-center rounded-lg bg-ai text-bg font-semibold px-4 py-2.5 text-sm hover:opacity-90">
          Edit inventory rooms
        </Link>
      </Card>

      <Card className="p-5">
        <SectionHeading title="Price move caps"
          note={`How far a received price may move, per category, before the three-way match flags it. Produce swings weekly; dry goods should not — so the cap is per category, both directions. Blank uses the ${DEFAULT_PRICE_CAP_PCT}% default. Beef up 20% may be the market; up 20,000% is a wrong unit of measure on the invoice — the cap catches both.`} />
        {capsError ? <p className="mb-3 text-sm text-state-seated">{capsError}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {ITEM_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-panel-up/30 px-4 py-2.5">
              <span className="text-sm text-ink-50">{ITEM_CATEGORY_LABELS[category as ItemCategory]}</span>
              <span className="flex items-center gap-1.5">
                <input
                  className="w-20 rounded-lg bg-panel border border-border px-2 py-1.5 text-right text-sm text-ink-50 tabular-nums placeholder:text-ink-400/60 focus:border-ai outline-none"
                  inputMode="decimal"
                  placeholder={String(DEFAULT_PRICE_CAP_PCT)}
                  value={caps[category] ?? ""}
                  disabled={busy}
                  onChange={(e) => setCaps((current) => ({ ...current, [category]: e.target.value }))}
                  onBlur={() => saveCap(category)}
                />
                <span className="text-xs text-ink-400">%</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-400 leading-relaxed">Saves as you leave each field. Items pick their category in the room editor on the Inventory tab.</p>
      </Card>

      <Card className="p-5">
        <SectionHeading title="The staff counting app" note="" />
        <p className="text-sm text-ink-200 max-w-2xl leading-relaxed">
          Staff can count from the Count tab on any phone, or from the Travola Pantry app for
          iOS and Android — same sign-in, same shelf order, same approval queue. The app keeps
          counting with no signal: entries queue on the phone and send themselves when it
          returns, so a dead spot in the walk-in costs nothing.
        </p>
      </Card>

      <Card className="p-5">
        <SectionHeading title="Not built yet, on purpose" note="Shelved for later architecting rather than half-shipped." />
        <ul className="space-y-2.5 text-sm text-ink-200 max-w-2xl">
          {[
            ["App-store listings", "The counting app builds today from the travola-pantry-mobile repo (Android Studio / Xcode). Play Store and App Store submission is a release step, not a build step."],
            ["Live POS connectors", "Theoretical usage already reads item-level sales from the shared database. Toast and Square integrations will feed the same tables; the variance engine does not change."],
            ["Vendor EDI feeds", "Invoices arrive by hand today. Electronic feeds from broadliners need vendor integration agreements — the three-way match is the manual stand-in until then."],
            ["Emailed report subscriptions", "The variance report in a manager's inbox every Monday at 8am. Needs an email provider account; the report itself is ready."],
            ["General-ledger posting", "Approved counts freeze a valuation. Posting that to a GL needs an accounting integration (QuickBooks et al) that does not exist yet — the valuation is ready for it."],
            ["Invoice scanning", "Receiving is typed today. The menu importer's photo-reading machinery will point at invoices later."],
          ].map(([title, detail]) => (
            <li key={title} className="rounded-xl border border-border bg-panel-up/30 px-4 py-3">
              <span className="block font-semibold text-ink-50">{title}</span>
              <span className="block text-xs text-ink-400 mt-1 leading-relaxed">{detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
