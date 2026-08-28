"use client";

// components/ui.tsx — the small set of shared controls.
//
// Charts and stat tiles live in components/charts.tsx; this file is the
// plain furniture every screen needs. One card, one radius, one hairline:
// the visual interest on this product comes from the content — the floor
// plan, the heatmap, the ranked bars — not from decorating containers.
import type { ReactNode } from "react";

/**
 * A card pads ITSELF. Padding used to be every caller's job, and two of
 * them forgot — the owner-code card and the plan cards rendered with
 * their text jammed against the border while the cards beside them
 * looked right. That is not a mistake worth being able to make.
 *
 * The caller can still override by passing its own `p-*` utility: this
 * detects one and stands down, because leaving both in place would leave
 * Tailwind's stylesheet order to decide which wins, and it does not
 * decide by what the caller wrote last.
 */
const HAS_PADDING = /(^|\s)p[xytrbl]?-\S/;

export function Card({ children, className = "", lit = false, as: Tag = "div" }: {
  children: ReactNode; className?: string; lit?: boolean; as?: "div" | "section" | "article";
}) {
  const padding = HAS_PADDING.test(className) ? "" : "p-5";
  return <Tag className={`card ${lit ? "card-lit" : ""} ${padding} ${className}`}>{children}</Tag>;
}

export function SectionHeading({ title, note, action }: { title: string; note?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        <h2 className="text-lg font-semibold text-ink-50 tracking-tight">{title}</h2>
        {note ? <p className="text-sm text-ink-400 mt-1 max-w-2xl leading-relaxed">{note}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Chip({ tone = "neutral", children }: {
  tone?: "neutral" | "good" | "bad" | "warn" | "accent"; children: ReactNode;
}) {
  const tones = {
    neutral: "bg-panel-up text-ink-200",
    good: "bg-state-availBg text-state-avail",
    bad: "bg-state-seatedBg text-state-seated",
    warn: "bg-state-diningBg text-state-dining",
    accent: "bg-ai-bg text-ai",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-ink-400 py-8 text-center border border-dashed border-border rounded-xl">
      {children}
    </p>
  );
}

export function Button({
  children, onClick, tone = "default", type = "button", disabled, className = "", title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const tones = {
    default: "bg-panel-up text-ink-50 hover:bg-panel-up/70 border border-border",
    primary: "bg-ai text-bg hover:opacity-90 border border-transparent font-semibold",
    danger: "bg-state-seatedBg text-state-seated hover:bg-state-seatedBg/70 border border-state-seated/30",
    ghost: "bg-transparent text-ink-400 hover:text-ink-50 border border-transparent",
  } as const;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  /** When present it REPLACES the hint rather than stacking under it.
   *  A field showing both "Optional." and "That is not a number" makes
   *  the reader work out which one applies right now. */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
      {error ? (
        <span className="block mt-1.5 text-xs text-state-seated leading-relaxed">{error}</span>
      ) : hint ? (
        <span className="block mt-1.5 text-xs text-ink-400 leading-relaxed">{hint}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg bg-panel border border-border px-3 py-2 text-sm text-ink-50 " +
  "placeholder:text-ink-400/60 focus:border-ai outline-none";

/**
 * Every tab opens the same way: a lit card carrying the section name, the
 * restaurant or subject, one line of orientation, and whatever belongs on
 * the right. Consistency here is what makes seven pages read as one
 * product rather than seven screens.
 */
export function PageHeader({ eyebrow, title, note, right }: {
  eyebrow: string; title: string; note?: ReactNode; right?: ReactNode;
}) {
  return (
    <header className="card card-lit p-5 sm:p-6 flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <p className="label">{eyebrow}</p>
        <h1 className="mt-1.5 text-3xl sm:text-[2.25rem] font-semibold tracking-[-0.035em] text-ink-50 leading-none">
          {title}
        </h1>
        {note ? <p className="text-sm text-ink-400 mt-2.5 max-w-2xl leading-relaxed">{note}</p> : null}
      </div>
      {right}
    </header>
  );
}

/** A staff initial in their own floor-plan colour — the same identity mark
 *  the floor app uses, so a name is recognisable at a glance. */
export function Avatar({ name, colorHex, dimmed }: { name: string; colorHex?: string | null; dimmed?: boolean }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  const tone = colorHex || "#818cf8";
  return (
    <span
      className="inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-bold shrink-0"
      style={{
        background: `${tone}22`,
        color: tone,
        border: `1px solid ${tone}55`,
        opacity: dimmed ? 0.45 : 1,
      }}
      aria-hidden="true"
    >
      {initials || "·"}
    </span>
  );
}
