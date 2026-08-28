"use client";

// components/Shell.tsx — the frame, matching Travola Home and the floor
// manager exactly.
//
// Same 56px bar, same brand lockup, same uppercase tab treatment, same
// mono status strip on the right. A manager moving between the three
// products should never feel a seam; the muscle memory is the point.
//
// Only the tabs that DO something are here. A nav full of empty pages
// tells a user the product is unfinished more loudly than a short nav
// tells them it is small.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/", label: "Today" },
  { href: "/close-out", label: "Close-out" },
  { href: "/history", label: "History" },
];

export function Shell({
  restaurantName, children,
}: {
  restaurantName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [clock, setClock] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Rendered only after mount: a server-rendered clock is wrong by the
  // time it reaches the browser and trips a hydration mismatch.
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
      setToday(now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }));
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 flex items-center px-4 sm:px-6 h-14 bg-panel border-b border-border shrink-0">
        <Link href="/" className="flex items-center gap-2.5 mr-4 sm:mr-8 shrink-0">
          <img src="/brand/travola-icon.svg" alt="" aria-hidden="true" className="w-6 h-6 rounded-[6px]" />
          <span className="hidden sm:flex items-baseline gap-2.5">
            <span className="font-display text-base font-bold tracking-wide text-ai">Travola</span>
            <span className="font-mono text-[9px] text-ink-400 tracking-[0.2em] uppercase">Pantry</span>
          </span>
        </Link>

        <nav className="flex h-full items-stretch overflow-x-auto" aria-label="Sections">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center px-3 sm:px-4 whitespace-nowrap text-[10.5px] font-bold tracking-[0.12em] uppercase border-b-2 ${
                  active ? "border-ai text-ai" : "border-transparent text-ink-400 hover:text-ink-50"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {/* One type system: mono at 11px throughout, hierarchy by weight
            and colour alone. Identical to Home's strip. */}
        <div className="ml-auto flex items-center gap-3 sm:gap-4 shrink-0 font-mono text-[11px] leading-none">
          <p className="hidden lg:flex items-center gap-2">
            <span className="text-ink-50 font-semibold tabular-nums">{clock ?? "—:—"}</span>
            <span className="text-border-hi" aria-hidden="true">·</span>
            <span className="text-ink-400">{today ?? ""}</span>
          </p>
          <span className="hidden lg:block w-px h-3.5 bg-border-hi" aria-hidden="true" />
          <span className="hidden md:inline font-semibold text-ink-50 truncate max-w-[18ch]" title={restaurantName}>
            {restaurantName}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="text-ink-400 hover:text-ink-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-6 mx-auto w-full max-w-[1560px]">{children}</main>
    </div>
  );
}
