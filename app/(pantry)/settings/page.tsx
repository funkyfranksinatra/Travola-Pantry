"use client";

// app/(pantry)/settings/page.tsx — Pantry's own settings.
//
// Small on purpose: the shared restaurant settings (hours, days, name)
// live in Travola Home and are not duplicated here — two screens
// editing one row is how the row ends up wrong. What lives here is
// what only Pantry owns: the room layout, and honest notes on what is
// not built yet.
import Link from "next/link";
import { Card, PageHeader, SectionHeading } from "@/components/ui";

export default function SettingsPage() {
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
