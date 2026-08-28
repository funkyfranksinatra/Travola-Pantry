"use client";

// components/charts.tsx — every mark Travola Home draws.
//
// Hand-rolled SVG rather than a charting library: these shapes are simple,
// and a library would add ~100KB to a page whose job is to open fast on a
// manager's phone in a back office.
//
// Rules that hold across every chart here, so the page reads as one system:
//
//   · ONE axis, always. Two measures of different scale get two charts,
//     never two y-scales — the single most common way a dashboard lies.
//   · Series colours come from --color-viz-* in fixed order and are never
//     cycled or reassigned. A filter that removes a series must not repaint
//     the survivors.
//   · Green and red are RESERVED for direction and always ship with an
//     arrow and a number, so a colour-blind reader never has to rely on hue.
//   · Grid and axes are recessive; the marks are the loudest thing.
//   · Every plot has a hover layer. A chart on a screen that does not
//     respond to the pointer reads as a picture of a chart.
import { useId, useState, type ReactNode } from "react";

export const VIZ = ["var(--color-viz-1)", "var(--color-viz-2)", "var(--color-viz-3)", "var(--color-viz-4)"];
export const SEQ = [
  "var(--color-seq-1)", "var(--color-seq-2)", "var(--color-seq-3)",
  "var(--color-seq-4)", "var(--color-seq-5)",
];

export type Point = { key: string; label: string; value: number | null; sample?: number };

// ── Direction ─────────────────────────────────────────────────────────

/**
 * A change, with an arrow. `goodWhen` matters: turn time going up is bad
 * while covers going up is good, and a dashboard that paints every rise
 * green teaches people to stop reading it.
 */
export function Delta({ pct, goodWhen = "up", basis, size = "sm" }: {
  pct: number | null | undefined;
  goodWhen?: "up" | "down" | "neutral";
  basis?: string;
  size?: "sm" | "lg";
}) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const good = goodWhen === "neutral" || flat ? null : (up && goodWhen === "up") || (!up && goodWhen === "down");
  const tone = good === null ? "text-ink-400 bg-panel-up" : good ? "text-state-avail bg-state-availBg" : "text-state-seated bg-state-seatedBg";
  return (
    <span
      title={basis}
      className={`inline-flex items-center gap-1 rounded-full font-semibold tabular-nums ${tone} ${
        size === "lg" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Arrow direction={flat ? "flat" : up ? "up" : "down"} />
      {flat ? "flat" : `${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
}

function Arrow({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "flat") {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </svg>
    );
  }
  const up = direction === "up";
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" role="img">
      <path
        d={up ? "M5 8.5V2M5 2 1.8 5.2M5 2l3.2 3.2" : "M5 1.5V8M5 8l3.2-3.2M5 8 1.8 4.8"}
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  );
}

// ── Tooltip plumbing ──────────────────────────────────────────────────

type Hover = { x: number; y: number; title: string; rows: Array<{ label: string; value: string; color?: string }> } | null;

function Tooltip({ hover }: { hover: Hover }) {
  if (!hover) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-border-hi bg-panel px-2.5 py-2 shadow-xl"
      style={{ left: `${hover.x}%`, top: hover.y, transform: "translate(-50%, -115%)", minWidth: 116 }}
    >
      <p className="text-[11px] text-ink-400 mb-1 whitespace-nowrap">{hover.title}</p>
      {hover.rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-3 whitespace-nowrap">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-300">
            {row.color ? <span className="w-2 h-2 rounded-sm" style={{ background: row.color }} /> : null}
            {row.label}
          </span>
          <span className="text-xs text-ink-50 tabular-nums font-semibold">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────

/** A shape, not a chart: no axes, no hover, no numbers. It exists to give
 *  a headline figure a direction at a glance. */
export function Sparkline({ points, height = 34, tone = "var(--color-viz-1)" }: {
  points: Array<number | null>; height?: number; tone?: string;
}) {
  const values = points.filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  const coords = values.map((v, i) => `${(i * step).toFixed(2)},${(100 - ((v - min) / span) * 100).toFixed(2)}`);
  const gradient = useId();
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: "100%" }} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.32" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,100 ${coords.join(" ")} 100,100`} fill={`url(#${gradient})`} />
      <polyline
        points={coords.join(" ")} fill="none" stroke={tone}
        strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────

export function StatTile({
  label, value, delta, goodWhen = "up", hint, spark, awaiting, footnote, accent = "var(--color-viz-1)",
}: {
  label: string;
  value: string;
  delta?: number | null;
  goodWhen?: "up" | "down" | "neutral";
  hint?: string;
  spark?: Array<number | null>;
  awaiting?: string | null;
  footnote?: string;
  accent?: string;
}) {
  return (
    <div className={`card card-lit card-hover p-4 flex flex-col ${awaiting ? "awaiting" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {awaiting ? (
          <span className="rounded-full bg-ai-bg px-2 py-0.5 text-[10px] font-semibold text-ai whitespace-nowrap">
            awaiting POS
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <span className="figure text-ink-50">{value}</span>
        {delta != null ? <span className="pb-1"><Delta pct={delta} goodWhen={goodWhen} /></span> : null}
      </div>
      {spark && !awaiting ? <div className="mt-3 -mx-1"><Sparkline points={spark} tone={accent} /></div> : null}
      {awaiting ? (
        <p className="mt-3 text-xs text-ink-400 leading-relaxed">{awaiting}</p>
      ) : hint ? (
        <p className="mt-3 text-xs text-ink-400 leading-relaxed">{hint}</p>
      ) : null}
      {footnote && !awaiting ? <p className="mt-1 text-[11px] text-ink-400/70">{footnote}</p> : null}
    </div>
  );
}

// ── Area chart ────────────────────────────────────────────────────────

/**
 * One or two series against one axis, over time.
 *
 * `partialLast` dashes the final segment: a month three days old plotted
 * beside eleven whole ones draws a cliff, and the cliff is the calendar,
 * not the business.
 */
export function AreaChart({
  series, format, height = 210, partialLast = false, yLabel,
}: {
  series: Array<{ name: string; points: Point[] }>;
  format: (value: number) => string;
  height?: number;
  partialLast?: boolean;
  yLabel?: string;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const gradient = useId();
  const primary = series[0]?.points ?? [];
  const usable = primary.filter((p) => p.value != null);
  if (usable.length < 2) return <Empty>Not enough history yet to draw a trend.</Empty>;

  // Below four points a line is not a trend. Two months of revenue joined
  // by a sloping line reads as a collapse, and the slope is entirely an
  // artefact of the second month being three days old. Bars state the two
  // figures without implying a direction between them.
  if (usable.length < 4) {
    return (
      <div>
        <Columns points={usable} format={format} height={Math.min(height, 130)} />
        {partialLast ? (
          <p className="text-[11px] text-ink-400 mt-2">
            {usable[usable.length - 1].label} is still in progress — a partial figure.
          </p>
        ) : null}
      </div>
    );
  }

  const all = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v != null);
  const max = Math.max(...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const step = 100 / (usable.length - 1);
  const y = (v: number) => 100 - ((v - min) / span) * 100;

  const path = (points: Point[]) =>
    points
      .filter((p) => p.value != null)
      .map((p, i) => `${(i * step).toFixed(2)},${y(p.value as number).toFixed(2)}`);

  const last = usable[usable.length - 1];
  const gridLines = [0, 25, 50, 75, 100];

  return (
    <figure className="relative m-0">
      <svg
        viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height, width: "100%" }}
        role="img" aria-label={`${series[0]?.name ?? "Series"} from ${usable[0].label} to ${last.label}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          const index = Math.max(0, Math.min(usable.length - 1, Math.round(ratio * (usable.length - 1))));
          const point = usable[index];
          setHover({
            x: (index / (usable.length - 1)) * 100,
            y: height * 0.5,
            title: point.label,
            rows: series.map((s, i) => {
              const match = s.points.find((p) => p.key === point.key);
              return {
                label: s.name,
                value: match?.value != null ? format(match.value) : "—",
                color: series.length > 1 ? VIZ[i] : undefined,
              };
            }),
          });
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={VIZ[0]} stopOpacity="0.38" />
            <stop offset="100%" stopColor={VIZ[0]} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridLines.map((g) => (
          <line key={g} x1="0" x2="100" y1={g} y2={g} stroke="var(--color-border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}

        <polygon points={`0,100 ${path(primary).join(" ")} 100,100`} fill={`url(#${gradient})`} />

        {series.map((s, i) => {
          const coords = path(s.points);
          const solid = partialLast && i === 0 ? coords.slice(0, -1) : coords;
          return (
            <g key={s.name}>
              <polyline
                points={solid.join(" ")} fill="none" stroke={VIZ[i]} strokeWidth="2"
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
                opacity={i === 0 ? 1 : 0.85}
              />
              {partialLast && i === 0 ? (
                <polyline
                  points={coords.slice(-2).join(" ")} fill="none" stroke={VIZ[i]} strokeWidth="2"
                  strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}

        {hover ? (
          <line x1={hover.x} x2={hover.x} y1="0" y2="100" stroke="var(--color-border-hi)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>

      {/* The endpoint marker sits outside the stretched SVG so it stays a
          circle: `preserveAspectRatio="none"` would squash it into an
          ellipse whose shape depends on the container width. */}
      <span
        className="pointer-events-none absolute w-2.5 h-2.5 rounded-full ring-2"
        style={{
          left: "100%", top: (y(last.value as number) / 100) * height,
          transform: "translate(-100%, -50%)",
          background: VIZ[0], boxShadow: "0 0 0 2px var(--color-panel-card)",
          // @ts-expect-error CSS custom property on a style object
          "--tw-ring-color": "transparent",
        }}
        aria-hidden="true"
      />

      <Tooltip hover={hover} />

      <figcaption className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-400">
        <span>{usable[0].label}</span>
        {series.length > 1 ? (
          <span className="flex items-center gap-3">
            {series.map((s, i) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 rounded-full" style={{ background: VIZ[i] }} />
                {s.name}
              </span>
            ))}
          </span>
        ) : yLabel ? (
          <span>{yLabel}</span>
        ) : null}
        <span className="text-ink-200 tabular-nums">
          {format(last.value as number)} · {last.label}
          {partialLast ? " (in progress)" : ""}
        </span>
      </figcaption>
    </figure>
  );
}

// ── Columns ───────────────────────────────────────────────────────────

/** Vertical bars for a small ordered set — days of the week, party sizes. */
export function Columns({ points, format, height = 170, highlight, tone = VIZ[0] }: {
  points: Point[]; format: (value: number) => string; height?: number; highlight?: string; tone?: string;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const values = points.map((p) => p.value ?? 0);
  const max = Math.max(1, ...values);
  if (!points.length) return <Empty>Nothing to chart in this window.</Empty>;
  return (
    <figure className="relative m-0">
      <div className="flex items-end gap-1.5" style={{ height }} onMouseLeave={() => setHover(null)}>
        {points.map((point, index) => {
          const value = point.value ?? 0;
          const isHigh = highlight === point.key;
          return (
            <button
              key={point.key}
              type="button"
              className="group relative flex-1 flex flex-col justify-end h-full min-w-0"
              onMouseEnter={() =>
                setHover({
                  x: ((index + 0.5) / points.length) * 100,
                  y: height * 0.35,
                  title: point.label,
                  rows: [
                    { label: "Covers", value: format(value) },
                    ...(point.sample != null ? [{ label: "Parties", value: point.sample.toLocaleString("en-US") }] : []),
                  ],
                })
              }
            >
              <span
                className="w-full rounded-t transition-[height,opacity]"
                style={{
                  height: `${Math.max(value > 0 ? 3 : 0, (value / max) * 100)}%`,
                  background: isHigh ? tone : "color-mix(in srgb, " + tone + " 55%, transparent)",
                  borderRadius: "4px 4px 0 0",
                }}
              />
            </button>
          );
        })}
      </div>
      <Tooltip hover={hover} />
      <div className="mt-2 flex gap-1.5">
        {points.map((point) => (
          <span key={point.key} className="flex-1 min-w-0 text-center text-[11px] text-ink-400 truncate">
            {point.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

// ── Ranked bars ───────────────────────────────────────────────────────

/** Horizontal bars for a ranked list. Direct-labelled, because a ranking
 *  the reader has to trace back to an axis is not a ranking. */
export function RankedBars({ rows, format, tone = VIZ[0], max: fixedMax }: {
  rows: Array<{ key: string; label: string; value: number; meta?: string }>;
  format: (value: number) => string;
  tone?: string;
  max?: number;
}) {
  if (!rows.length) return <Empty>Nothing to rank yet.</Empty>;
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-sm text-ink-50 truncate">{row.label}</span>
            <span className="text-sm text-ink-200 tabular-nums shrink-0">{format(row.value)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 h-1.5 rounded-full bg-panel-up/70 overflow-hidden">
              <span
                className="block h-full"
                style={{ width: `${Math.max(row.value > 0 ? 2 : 0, (row.value / max) * 100)}%`, background: tone, borderRadius: 4 }}
              />
            </span>
            {row.meta ? <span className="text-[11px] text-ink-400 shrink-0 tabular-nums">{row.meta}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Heatmap ───────────────────────────────────────────────────────────

/**
 * Day of week × hour of service. The one picture that answers "when are we
 * actually busy" without the reader assembling it from two bar charts.
 * Sequential single hue, dark → light: magnitude, so never a rainbow.
 */
export function Heatmap({ cells, days, hours, format }: {
  cells: Map<string, number>;
  days: string[];
  hours: number[];
  format: (value: number) => string;
}) {
  const [hover, setHover] = useState<Hover>(null);
  const values = [...cells.values()].filter((v) => v > 0);
  if (!values.length) return <Empty>Not enough service history to map the week.</Empty>;
  const max = Math.max(...values);
  const bucket = (value: number) => {
    if (value <= 0) return "var(--color-panel-up)";
    const index = Math.min(SEQ.length - 1, Math.floor((value / max) * SEQ.length));
    return SEQ[index];
  };
  const hourLabel = (h: number) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);

  return (
    <figure className="relative m-0" onMouseLeave={() => setHover(null)}>
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          <div className="flex gap-1 pl-9 mb-1">
            {hours.map((hour) => (
              <span key={hour} className="flex-1 text-center text-[10px] text-ink-400 tabular-nums">
                {hourLabel(hour)}
              </span>
            ))}
          </div>
          {days.map((day, dayIndex) => (
            <div key={day} className="flex items-center gap-1 mb-1">
              <span className="w-8 text-[10px] text-ink-400 shrink-0">{day.slice(0, 3)}</span>
              {hours.map((hour, hourIndex) => {
                const value = cells.get(`${dayIndex}-${hour}`) ?? 0;
                return (
                  <button
                    key={hour}
                    type="button"
                    className="flex-1 h-6 rounded-[3px] hover:ring-1 hover:ring-ai"
                    style={{ background: bucket(value) }}
                    onMouseEnter={() =>
                      setHover({
                        x: ((hourIndex + 0.5) / hours.length) * 100,
                        y: 24 + dayIndex * 28,
                        title: `${day}, ${hourLabel(hour)}`,
                        rows: [{ label: "Covers", value: format(value) }],
                      })
                    }
                    aria-label={`${day} ${hourLabel(hour)}: ${format(value)} covers`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Tooltip hover={hover} />
      <figcaption className="mt-2 flex items-center gap-2 text-[11px] text-ink-400">
        <span>Quieter</span>
        {SEQ.map((step) => (
          <span key={step} className="w-6 h-2 rounded-sm" style={{ background: step }} />
        ))}
        <span>Busier</span>
        <span className="ml-auto tabular-nums">peak {format(max)} covers</span>
      </figcaption>
    </figure>
  );
}

// ── Ring ──────────────────────────────────────────────────────────────

/** A single share, 0–100. Used where the part-of-whole IS the headline. */
export function Ring({ pct, label, caption, tone = VIZ[0], size = 120 }: {
  pct: number | null; label: string; caption?: string; tone?: string; size?: number;
}) {
  const value = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label}: ${value.toFixed(0)}%`}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--color-panel-up)" strokeWidth="9" />
        <circle
          cx="50" cy="50" r={radius} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="52" textAnchor="middle" dominantBaseline="middle"
          className="tabular" fill="var(--color-ink-50)" fontSize="21" fontWeight="650" letterSpacing="-1">
          {pct == null ? "—" : `${value.toFixed(0)}%`}
        </text>
      </svg>
      <div className="min-w-0">
        <p className="label">{label}</p>
        {caption ? <p className="text-sm text-ink-400 mt-1.5 leading-relaxed">{caption}</p> : null}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-ink-400 py-8 text-center border border-dashed border-border rounded-xl">
      {children}
    </p>
  );
}
