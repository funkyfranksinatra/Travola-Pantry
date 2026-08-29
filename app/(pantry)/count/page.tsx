"use client";

// app/(pantry)/count/page.tsx — counting, and the approval queue.
//
// The count flow is MOBILE-FIRST: one column, 48px+ targets, numeric
// keyboards, room-by-room in shelf order. It is the same page a staff
// phone opens — the "restricted employee app" is this flow reached with
// the restaurant code; a native wrapper can ship later without changing
// a line here. Every entry autosaves on its own round-trip, so a dead
// battery in the walk-in costs one keystroke, not the count.
//
// The approval queue lives on the same tab because the manager who
// approves is the same person who counts on other nights.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, Chip, Empty, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { money, dateLabel } from "@/lib/format";

type Room = { id: string; name: string; kind: string; itemCount: number; sortOrder: number };
type Item = { id: string; roomId: string; name: string; countUnit: string; isKeyItem: boolean; sortOrder: number };
type CountSummary = {
  id: string; status: string; type: string; countedBy: string;
  submittedAt: string | null; approvedBy: string | null; approvedAt: string | null;
  rejectReason: string | null; totalValueCents: number; createdAt: string; lineCount: number;
};

function CountInner() {
  const params = useSearchParams();
  const [counts, setCounts] = useState<CountSummary[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Active counting session
  const [activeId, setActiveId] = useState<string | null>(params.get("resume"));
  const [countedBy, setCountedBy] = useState("");
  const [countType, setCountType] = useState<"full" | "key" | "spot">("spot");
  const [roomIndex, setRoomIndex] = useState(0);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, "saved" | "saving" | "outlier">>({});
  const [outlierNote, setOutlierNote] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const [countsRes, roomsRes, itemsRes] = await Promise.all([
      fetch("/api/counts"), fetch("/api/rooms"), fetch("/api/items"),
    ]);
    const [countsBody, roomsBody, itemsBody] = await Promise.all([countsRes.json(), roomsRes.json(), itemsRes.json()]);
    if (!countsRes.ok) { setError(countsBody.error ?? "Could not load."); return; }
    setCounts(countsBody.counts);
    setRooms((roomsBody.rooms ?? []).filter((room: Room) => room.itemCount > 0));
    setItems(itemsBody.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "That did not work.");
    return body;
  }

  async function start() {
    setBusy(true); setError(null);
    try {
      const body = await post({ action: "start", type: countType, countedBy: countedBy.trim() || "staff" });
      setActiveId(body.id);
      setEntries({}); setSaved({}); setOutlierNote({}); setRoomIndex(0);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function saveLine(item: Item, raw: string) {
    if (raw.trim() === "") return;
    const quantity = Number(raw);
    if (!Number.isFinite(quantity) || quantity < 0) return;
    setSaved((current) => ({ ...current, [item.id]: "saving" }));
    try {
      const body = await post({ action: "line", countId: activeId, itemId: item.id, quantity });
      setSaved((current) => ({ ...current, [item.id]: body.outlier ? "outlier" : "saved" }));
      if (body.outlier) setOutlierNote((current) => ({ ...current, [item.id]: body.previous }));
    } catch (err) {
      setError((err as Error).message);
      setSaved((current) => { const next = { ...current }; delete next[item.id]; return next; });
    }
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      await post({ action: "submit", countId: activeId });
      setActiveId(null);
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function decide(count: CountSummary, action: "approve" | "reject") {
    setBusy(true); setError(null);
    try {
      const reason = action === "reject" ? window.prompt("Why is this count being rejected? The counter sees this.") : undefined;
      if (action === "reject" && reason === null) return;
      await post({ action, countId: count.id, reason });
      await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (!counts) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  // ── Active counting session ──────────────────────────────────────
  if (activeId) {
    const wantedItems = items.filter((item) =>
      (countType !== "key" || item.isKeyItem));
    const roomsWithItems = rooms.filter((room) => wantedItems.some((item) => item.roomId === room.id));
    const room = roomsWithItems[roomIndex] ?? roomsWithItems[0];
    const roomItems = room ? wantedItems.filter((item) => item.roomId === room.id) : [];
    const entered = Object.keys(saved).filter((id) => saved[id] === "saved" || saved[id] === "outlier").length;

    return (
      <div className="flex flex-col gap-4 max-w-lg mx-auto w-full">
        <PageHeader
          eyebrow={`Counting · ${entered} of ${wantedItems.length}`}
          title={room?.name ?? "No rooms"}
          note="Walk the shelves in order. Every entry saves the moment you leave the box."
        />
        {error ? <Card className="p-3 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

        {roomsWithItems.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {roomsWithItems.map((r, index) => (
              <button key={r.id} type="button" onClick={() => setRoomIndex(index)} aria-pressed={index === roomIndex}
                className={`rounded-lg px-3 py-2 text-xs font-semibold border min-h-[40px] ${index === roomIndex ? "bg-ai-bg border-ai/40 text-ai" : "bg-panel border-border text-ink-400"}`}>
                {r.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          {roomItems.map((item) => (
            <Card key={item.id} className={`p-4 ${saved[item.id] === "outlier" ? "border-l-2 border-l-state-dining" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block text-base text-ink-50 truncate">{item.name}</span>
                  <span className="block text-[11px] text-ink-400 mt-0.5">{item.countUnit}</span>
                </div>
                <input
                  inputMode="decimal"
                  className="w-28 h-12 rounded-lg bg-panel border border-border text-right px-3 text-lg font-semibold text-ink-50 tabular-nums focus:border-ai outline-none"
                  placeholder="—"
                  value={entries[item.id] ?? ""}
                  onChange={(event) => setEntries((current) => ({ ...current, [item.id]: event.target.value }))}
                  onBlur={(event) => saveLine(item, event.target.value)}
                />
                <span className="w-5 text-center text-sm shrink-0" aria-hidden="true">
                  {saved[item.id] === "saving" ? "…" : saved[item.id] === "saved" ? "✓" : saved[item.id] === "outlier" ? "!" : ""}
                </span>
              </div>
              {saved[item.id] === "outlier" ? (
                <p className="mt-2 text-xs text-state-dining">
                  Last approved count was {outlierNote[item.id]}. Saved anyway — check it is not a slip.
                </p>
              ) : null}
            </Card>
          ))}
        </div>

        <div className="sticky bottom-4 flex justify-between items-center gap-3">
          <Button tone="ghost" onClick={() => setActiveId(null)}>Finish later</Button>
          <Button tone="primary" disabled={busy || entered === 0} onClick={submit}>
            Submit {entered} item{entered === 1 ? "" : "s"} for approval
          </Button>
        </div>
      </div>
    );
  }

  // ── Landing: start a count + the approval queue ──────────────────
  const pending = counts.filter((count) => count.status === "submitted");
  const recent = counts.filter((count) => count.status !== "submitted").slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Count" title="Physical counts"
        note="Staff count and submit; a manager approves. Only an approved count changes valuation or variance — a count reprices the building, so it gets a second pair of eyes." />
      {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

      <Card className="p-5">
        <SectionHeading title="Start a count" note={rooms.length ? "Works one-handed on a phone, in shelf order, saving as you go." : "Set up rooms and items under Inventory first."} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Your name" hint="Shown to whoever approves.">
            <input className={inputClass} value={countedBy} onChange={(event) => setCountedBy(event.target.value)} placeholder="e.g. Dana" />
          </Field>
          <Field label="What kind">
            <div className="flex gap-2">
              {([["spot", "Spot"], ["key", "Key items"], ["full", "Full"]] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setCountType(value)} aria-pressed={countType === value}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold border min-h-[42px] ${countType === value ? "bg-ai-bg border-ai/40 text-ai" : "bg-panel border-border text-ink-400 hover:text-ink-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Button tone="primary" disabled={busy || !rooms.length} onClick={start}>Start counting</Button>
        </div>
      </Card>

      {pending.length ? (
        <Card className="p-5 border-l-2 border-l-ai">
          <SectionHeading title="Waiting for approval" note="Approving freezes the valuation into the count. Rejecting sends it back with a reason." />
          <ul className="space-y-3">
            {pending.map((count) => (
              <li key={count.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel-up/40 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block text-sm text-ink-50">
                    {count.countedBy} · {count.type} count · {count.lineCount} item{count.lineCount === 1 ? "" : "s"}
                  </span>
                  <span className="block text-[11px] text-ink-400 mt-0.5">
                    Submitted {count.submittedAt ? dateLabel(count.submittedAt.slice(0, 10)) : ""}
                  </span>
                </div>
                <Button tone="primary" disabled={busy} onClick={() => decide(count, "approve")}>Approve</Button>
                <Button disabled={busy} onClick={() => decide(count, "reject")}>Reject</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-5 pb-3"><SectionHeading title="Recent counts" note="" /></div>
        {recent.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-400">No counts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>When</th><th>By</th><th>Type</th><th className="text-right">Items</th><th className="text-right">Value on hand</th><th>Status</th></tr></thead>
              <tbody>
                {recent.map((count) => (
                  <tr key={count.id}>
                    <td>{dateLabel(count.createdAt.slice(0, 10))}</td>
                    <td>{count.countedBy}</td>
                    <td className="capitalize">{count.type}</td>
                    <td className="text-right tabular-nums">{count.lineCount}</td>
                    <td className="text-right tabular-nums">{count.status === "approved" ? money(count.totalValueCents) : "—"}</td>
                    <td>
                      <Chip tone={count.status === "approved" ? "good" : count.status === "rejected" ? "bad" : "neutral"}>{count.status}</Chip>
                      {count.status === "rejected" && count.rejectReason ? (
                        <span className="block text-[11px] text-ink-400 mt-1 max-w-[26ch] truncate" title={count.rejectReason}>{count.rejectReason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CountPage() {
  return <Suspense fallback={<p className="text-sm text-ink-400">Loading…</p>}><CountInner /></Suspense>;
}
