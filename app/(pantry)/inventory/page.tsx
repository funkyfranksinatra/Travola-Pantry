"use client";

// app/(pantry)/inventory/page.tsx — the storage map and what is on the
// shelves.
//
// Two levels, matching how the building is walked:
//   the MAP    — rooms on a canvas; click one to enter it
//   the ROOM   — its items in shelf order, editable in place
//
// Edit mode (?edit=1, entered from Settings) is the floor-editor
// gesture set: add rooms, drag, resize, remove; one save on Done.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Chip, Field, PageHeader, SectionHeading, inputClass } from "@/components/ui";
import { RoomCanvas, toneFor, type Room } from "@/components/RoomCanvas";
import { ROOM_KINDS, ROOM_KIND_LABELS, ITEM_KINDS, type RoomKind } from "@/lib/inventory";
import { money } from "@/lib/format";

type Item = {
  id: string; roomId: string; name: string; kind: string;
  purchaseUnit: string; countUnit: string; usageUnit: string;
  countPerPurchase: number; usagePerCount: number;
  lastCostCents: number; costPerCountCents: number;
  parLevel: number | null; isKeyItem: boolean; sortOrder: number;
};

const EMPTY_ITEM = {
  name: "", kind: "food", purchaseUnit: "case", countUnit: "each", usageUnit: "each",
  countPerPurchase: "1", usagePerCount: "1", lastCost: "", parLevel: "", isKeyItem: false,
};

function InventoryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const editing = params.get("edit") === "1";

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [openRoom, setOpenRoom] = useState<Room | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomKind, setNewRoomKind] = useState<RoomKind>("walkin");

  const [form, setForm] = useState({ ...EMPTY_ITEM });
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const loadRooms = useCallback(async () => {
    const response = await fetch("/api/rooms");
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not load."); return; }
    setRooms(body.rooms);
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const loadItems = useCallback(async (room: Room) => {
    const response = await fetch(`/api/items?room=${room.id}`);
    const body = await response.json();
    if (response.ok) setItems(body.items);
  }, []);

  async function post(path: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "That did not work.");
      return body;
    } catch (err) { setError((err as Error).message); return null; }
    finally { setBusy(false); }
  }

  async function addRoom(event: React.FormEvent) {
    event.preventDefault();
    const body = await post("/api/rooms", { action: "create", name: newRoomName, kind: newRoomKind });
    if (!body) return;
    setNewRoomName("");
    setRooms((current) => [...(current ?? []), body.room]);
  }

  async function doneEditing() {
    if (rooms) await post("/api/rooms", { action: "layout", rooms });
    router.push("/inventory");
  }

  async function removeRoom(room: Room) {
    const body = await post("/api/rooms", { action: "remove", id: room.id });
    if (body) setRooms((current) => (current ?? []).filter((r) => r.id !== room.id));
  }

  function openItemEditor(item: Item | null) {
    setEditingItem(item);
    setForm(item ? {
      name: item.name, kind: item.kind, purchaseUnit: item.purchaseUnit,
      countUnit: item.countUnit, usageUnit: item.usageUnit,
      countPerPurchase: String(item.countPerPurchase), usagePerCount: String(item.usagePerCount),
      lastCost: item.lastCostCents ? (item.lastCostCents / 100).toFixed(2) : "",
      parLevel: item.parLevel == null ? "" : String(item.parLevel),
      isKeyItem: item.isKeyItem,
    } : { ...EMPTY_ITEM });
  }

  async function saveItem(event: React.FormEvent) {
    event.preventDefault();
    if (!openRoom) return;
    const payload = {
      action: editingItem ? "update" : "create",
      id: editingItem?.id, roomId: openRoom.id,
      name: form.name, kind: form.kind,
      purchaseUnit: form.purchaseUnit, countUnit: form.countUnit, usageUnit: form.usageUnit,
      countPerPurchase: Number(form.countPerPurchase), usagePerCount: Number(form.usagePerCount),
      lastCostCents: form.lastCost.trim() === "" ? 0 : Math.round(Number(form.lastCost.replace(/[$,]/g, "")) * 100),
      parLevel: form.parLevel.trim() === "" ? null : Number(form.parLevel),
      isKeyItem: form.isKeyItem,
    };
    const body = await post("/api/items", payload);
    if (!body) return;
    openItemEditor(null);
    await loadItems(openRoom);
    await loadRooms();
  }

  async function removeItem(item: Item) {
    const body = await post("/api/items", { action: "remove", id: item.id });
    if (body && openRoom) { await loadItems(openRoom); await loadRooms(); }
  }

  async function moveItem(item: Item, direction: -1 | 1) {
    const index = items.findIndex((i) => i.id === item.id);
    const swap = index + direction;
    if (swap < 0 || swap >= items.length) return;
    const next = [...items];
    [next[index], next[swap]] = [next[swap], next[index]];
    setItems(next);
    await post("/api/items", { action: "reorder", ids: next.map((i) => i.id) });
  }

  if (!rooms) return <p className="text-sm text-ink-400">{error ?? "Loading…"}</p>;

  // ── Inside a room ────────────────────────────────────────────────
  if (openRoom && !editing) {
    const tone = toneFor(openRoom.kind);
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Inventory"
          title={openRoom.name}
          note={`${ROOM_KIND_LABELS[openRoom.kind as RoomKind] ?? openRoom.kind} · items listed in the order you walk the shelves — counting follows this order exactly.`}
          right={
            <button type="button" onClick={() => { setOpenRoom(null); setItems([]); openItemEditor(null); }} className="text-sm text-ai hover:underline">
              ← All rooms
            </button>
          }
        />
        {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

        <section className="grid gap-5 lg:grid-cols-5 items-start">
          <Card className="lg:col-span-3 p-0 overflow-hidden">
            {items.length === 0 ? (
              <p className="p-5 text-sm text-ink-400">Nothing on these shelves yet. Add the first item →</p>
            ) : (
              <ul>
                {items.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-panel-up/40">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tone.stroke }} aria-hidden="true" />
                    <button type="button" onClick={() => openItemEditor(item)} className="min-w-0 flex-1 text-left">
                      <span className="block text-sm text-ink-50 truncate">
                        {item.name}
                        {item.isKeyItem ? <span className="ml-2"><Chip tone="accent">key</Chip></span> : null}
                      </span>
                      <span className="block text-[11px] text-ink-400 mt-0.5">
                        counted in {item.countUnit} · {money(Math.round(item.costPerCountCents))}/{item.countUnit}
                        {item.parLevel != null ? ` · par ${item.parLevel}` : ""}
                      </span>
                    </button>
                    <span className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => moveItem(item, -1)} disabled={index === 0} className="px-1.5 py-1 text-ink-400 hover:text-ink-50 disabled:opacity-25" aria-label="Move up">↑</button>
                      <button type="button" onClick={() => moveItem(item, 1)} disabled={index === items.length - 1} className="px-1.5 py-1 text-ink-400 hover:text-ink-50 disabled:opacity-25" aria-label="Move down">↓</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-2 p-5">
            <SectionHeading
              title={editingItem ? `Edit ${editingItem.name}` : "Add an item"}
              note="The three units are the whole game: how it is bought, how it is counted standing at the shelf, and how a recipe uses it."
            />
            <form onSubmit={saveItem} className="grid gap-3">
              <Field label="Name">
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ribeye, whole" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kind">
                  <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    {ITEM_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                </Field>
                <Field label="Cost per purchase unit" hint="From the last invoice.">
                  <input className={inputClass} inputMode="decimal" placeholder="0.00" value={form.lastCost} onChange={(e) => setForm({ ...form, lastCost: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Bought as"><input className={inputClass} value={form.purchaseUnit} onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value })} placeholder="case" /></Field>
                <Field label="Counted as"><input className={inputClass} value={form.countUnit} onChange={(e) => setForm({ ...form, countUnit: e.target.value })} placeholder="lb" /></Field>
                <Field label="Used as"><input className={inputClass} value={form.usageUnit} onChange={(e) => setForm({ ...form, usageUnit: e.target.value })} placeholder="oz" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`${form.countUnit || "count"} per ${form.purchaseUnit || "purchase"}`} hint="e.g. 25 lb in a case.">
                  <input className={inputClass} inputMode="decimal" value={form.countPerPurchase} onChange={(e) => setForm({ ...form, countPerPurchase: e.target.value })} />
                </Field>
                <Field label={`${form.usageUnit || "usage"} per ${form.countUnit || "count"}`} hint="e.g. 16 oz in a lb.">
                  <input className={inputClass} inputMode="decimal" value={form.usagePerCount} onChange={(e) => setForm({ ...form, usagePerCount: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <Field label="Par level" hint={`Target on hand, in ${form.countUnit || "count units"}.`}>
                  <input className={inputClass} inputMode="decimal" value={form.parLevel} onChange={(e) => setForm({ ...form, parLevel: e.target.value })} placeholder="—" />
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm text-ink-200">
                  <input type="checkbox" checked={form.isKeyItem} onChange={(e) => setForm({ ...form, isKeyItem: e.target.checked })} className="accent-[#818cf8]" />
                  Key item — counted weekly
                </label>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" tone="primary" disabled={busy || !form.name.trim()}>
                  {editingItem ? "Save changes" : "Add to this room"}
                </Button>
                {editingItem ? (
                  <>
                    <Button tone="ghost" onClick={() => openItemEditor(null)}>Cancel</Button>
                    <button type="button" onClick={() => removeItem(editingItem)} className="ml-auto text-sm text-state-seated hover:underline">Remove</button>
                  </>
                ) : null}
              </div>
            </form>
          </Card>
        </section>
      </div>
    );
  }

  // ── The map ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Inventory"
        title={editing ? "Edit your rooms" : "Your storage"}
        note={
          editing
            ? "Drag rooms to where they sit in the building; drag the corner to resize. Positions save when you press Done."
            : "The map mirrors the building, so the count sheet can follow the shelves. Click a room to see what it holds."
        }
        right={
          editing ? (
            <Button tone="primary" disabled={busy} onClick={doneEditing}>Done editing</Button>
          ) : rooms.length ? (
            <span className="text-xs text-ink-400">Rearrange under Settings</span>
          ) : null
        }
      />
      {error ? <Card className="p-4 border-l-2 border-l-state-seated"><p className="text-sm text-state-seated">{error}</p></Card> : null}

      {editing ? (
        <Card className="p-4">
          <form onSubmit={addRoom} className="flex flex-wrap items-end gap-3">
            <Field label="Room name">
              <input className={inputClass} value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} placeholder="Walk-in cooler" />
            </Field>
            <Field label="Kind">
              <select className={inputClass} value={newRoomKind} onChange={(e) => setNewRoomKind(e.target.value as RoomKind)}>
                {ROOM_KINDS.map((kind) => <option key={kind} value={kind}>{ROOM_KIND_LABELS[kind]}</option>)}
              </select>
            </Field>
            <Button type="submit" disabled={busy || !newRoomName.trim()}>Add room</Button>
          </form>
        </Card>
      ) : null}

      <RoomCanvas
        rooms={rooms}
        editing={editing}
        onChange={setRooms}
        onOpen={(room) => { setOpenRoom(room); loadItems(room); }}
        onRemove={removeRoom}
      />
    </div>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink-400">Loading…</p>}>
      <InventoryInner />
    </Suspense>
  );
}
