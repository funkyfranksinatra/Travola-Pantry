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

  // ── Food-cost target ──
  const [target, setTarget] = useState("");
  const [targetSaved, setTargetSaved] = useState<number | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pantry-settings")
      .then((response) => response.json())
      .then((body) => {
        if (body.foodCostTargetPct != null) { setTargetSaved(body.foodCostTargetPct); setTarget(String(body.foodCostTargetPct)); }
      })
      .catch(() => setTargetError("Could not load the target."));
  }, []);

  async function saveTarget() {
    const raw = target.trim();
    const value = raw === "" ? null : Number(raw);
    if (value === targetSaved || (raw === "" && targetSaved == null)) return;
    setTargetError(null);
    try {
      const response = await fetch("/api/pantry-settings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set", foodCostTargetPct: raw === "" ? null : value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setTargetSaved(body.foodCostTargetPct);
    } catch (err) { setTargetError((err as Error).message || "Could not save."); }
  }

  // ── Weekly report subscription ──
  const [subEmail, setSubEmail] = useState("");
  const [subEnabled, setSubEnabled] = useState(true);
  const [subSaved, setSubSaved] = useState<{ email: string; enabled: boolean; lastSentAt: string | null } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [subNote, setSubNote] = useState<string | null>(null);
  const [subError, setSubError] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);

  useEffect(() => {
    fetch("/api/subscription")
      .then((response) => response.json())
      .then((body) => {
        setProviderConfigured(Boolean(body.providerConfigured));
        setSetupHint(body.setupHint ?? null);
        if (body.subscription) {
          setSubSaved(body.subscription);
          setSubEmail(body.subscription.email);
          setSubEnabled(body.subscription.enabled);
        }
      })
      .catch(() => setSubError("Could not load the subscription."));
  }, []);

  async function subPost(payload: Record<string, unknown>) {
    setSubBusy(true); setSubError(null); setSubNote(null);
    try {
      const response = await fetch("/api/subscription", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "That did not work.");
      return body;
    } catch (err) { setSubError((err as Error).message); return null; }
    finally { setSubBusy(false); }
  }

  async function saveSubscription() {
    const body = await subPost({ action: "set", email: subEmail, enabled: subEnabled });
    if (body) { setSubSaved({ email: subEmail.trim(), enabled: subEnabled, lastSentAt: subSaved?.lastSentAt ?? null }); setSubNote("Saved."); }
  }

  async function sendTest() {
    const body = await subPost({ action: "test" });
    if (body) setSubNote(`Sent to ${body.sentTo}. If it is not there in a minute, check spam — then the provider's dashboard.`);
  }

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
        <SectionHeading title="Food-cost target"
          note="The food-cost % this restaurant manages to. One number, ten seconds to set — and the trend chart, the variance report and the Monday email all gain a verdict: not just 33.1%, but 33.1% against your 30." />
        {targetError ? <p className="mb-3 text-sm text-state-seated">{targetError}</p> : null}
        <label className="flex items-center gap-2 max-w-[200px]">
          <input
            className="w-24 rounded-lg bg-panel border border-border px-3 py-2 text-right text-sm text-ink-50 tabular-nums placeholder:text-ink-400/60 focus:border-ai outline-none"
            inputMode="decimal" placeholder="30"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onBlur={saveTarget}
          />
          <span className="text-sm text-ink-400">% of net sales</span>
        </label>
        <p className="mt-2 text-xs text-ink-400">Saves when you leave the field. Blank removes the target. Most full-service restaurants aim for 25–35%.</p>
      </Card>

      <Card className="p-5">
        <SectionHeading title="Weekly report email"
          note="The variance window's headline numbers — food cost, % of sales, the worst variances — in an inbox every Monday morning. Same arithmetic as the Recipes tab; nobody has to remember to run anything." />
        {subError ? <p className="mb-3 text-sm text-state-seated">{subError}</p> : null}
        {subNote && !subError ? <p className="mb-3 text-sm text-state-avail">{subNote}</p> : null}
        <div className="flex flex-wrap items-end gap-3 max-w-xl">
          <label className="block flex-1 min-w-[220px]">
            <span className="label block mb-1.5">Send it to</span>
            <input
              className="w-full rounded-lg bg-panel border border-border px-3 py-2 text-sm text-ink-50 placeholder:text-ink-400/60 focus:border-ai outline-none"
              type="email" placeholder="manager@restaurant.com"
              value={subEmail} onChange={(e) => setSubEmail(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-200">
            <input type="checkbox" checked={subEnabled} onChange={(e) => setSubEnabled(e.target.checked)} className="accent-[#818cf8]" />
            On
          </label>
          <button type="button" disabled={subBusy || !subEmail.trim()} onClick={saveSubscription}
            className="rounded-lg bg-ai text-bg font-semibold px-4 py-2.5 text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            Save
          </button>
          {subSaved && providerConfigured ? (
            <button type="button" disabled={subBusy} onClick={sendTest}
              className="rounded-lg bg-panel-up text-ink-50 border border-border px-4 py-2.5 text-sm hover:bg-panel-up/70 disabled:opacity-40">
              Send one now
            </button>
          ) : null}
        </div>
        {providerConfigured === false ? (
          <p className="mt-3 rounded-lg bg-panel-up/50 border border-border px-3.5 py-2.5 text-xs text-ink-200 leading-relaxed max-w-xl">
            The address saves now, but no emails go out until the deployment has an email provider:
            {" "}{setupHint ?? "set RESEND_API_KEY on the Vercel project."} The Monday schedule itself is
            already wired (it also needs CRON_SECRET set — any long random string).
          </p>
        ) : null}
        {subSaved?.lastSentAt ? (
          <p className="mt-3 text-xs text-ink-400">Last sent {new Date(subSaved.lastSentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</p>
        ) : null}
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
