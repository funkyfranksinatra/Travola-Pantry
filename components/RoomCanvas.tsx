"use client";

// components/RoomCanvas.tsx — the storage map, drawn and dragged.
//
// The same edit-mode idiom as the floor app's room editor on purpose: a
// manager who has laid out their dining room already knows this
// gesture. View mode: click a room to enter it. Edit mode: drag to
// move, drag the corner to resize, positions saved once on Done.
//
// Drag maths is pointer-event based and lives entirely on the client;
// the server hears about layout exactly once, when editing ends.
import { useCallback, useEffect, useRef, useState } from "react";
import { ROOM_KIND_LABELS, type RoomKind } from "@/lib/inventory";

export type Room = {
  id: string; name: string; kind: string;
  x: number; y: number; w: number; h: number;
  sortOrder: number; itemCount: number;
};

const KIND_TONE: Record<string, { fill: string; stroke: string; text: string }> = {
  walkin:  { fill: "rgba(96,165,250,0.12)",  stroke: "rgba(96,165,250,0.45)",  text: "#bfdbfe" },
  freezer: { fill: "rgba(165,180,252,0.12)", stroke: "rgba(165,180,252,0.45)", text: "#e0e7ff" },
  dry:     { fill: "rgba(224,176,99,0.12)",  stroke: "rgba(224,176,99,0.42)",  text: "#eed3a5" },
  bar:     { fill: "rgba(202,89,228,0.10)",  stroke: "rgba(202,89,228,0.40)",  text: "#eecbf7" },
  cellar:  { fill: "rgba(168,150,224,0.12)", stroke: "rgba(168,150,224,0.42)", text: "#d3c9ef" },
  prep:    { fill: "rgba(82,199,148,0.11)",  stroke: "rgba(82,199,148,0.40)",  text: "#a9e3c7" },
  other:   { fill: "rgba(161,161,170,0.10)", stroke: "rgba(161,161,170,0.35)", text: "#d4d4d8" },
};
export const toneFor = (kind: string) => KIND_TONE[kind] ?? KIND_TONE.other;

const GRID = 20;
const snap = (value: number) => Math.round(value / GRID) * GRID;

export function RoomCanvas({ rooms, editing, onChange, onOpen, onRemove }: {
  rooms: Room[];
  editing: boolean;
  onChange: (rooms: Room[]) => void;
  onOpen: (room: Room) => void;
  onRemove: (room: Room) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; orig: Room } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent, room: Room, mode: "move" | "resize") => {
    if (!editing) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { id: room.id, mode, startX: event.clientX, startY: event.clientY, orig: { ...room } };
  }, [editing]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    onChange(rooms.map((room) => {
      if (room.id !== drag.id) return room;
      if (drag.mode === "move") {
        return { ...room, x: Math.max(0, snap(drag.orig.x + dx)), y: Math.max(0, snap(drag.orig.y + dy)) };
      }
      return {
        ...room,
        w: Math.min(600, Math.max(120, snap(drag.orig.w + dx))),
        h: Math.min(500, Math.max(100, snap(drag.orig.h + dy))),
      };
    }));
  }, [rooms, onChange]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // The canvas grows to hold its lowest room rather than clipping it.
  const depth = Math.max(420, ...rooms.map((room) => room.y + room.h + 60));

  return (
    <div
      ref={canvasRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`relative w-full rounded-xl border overflow-hidden ${
        editing ? "border-ai/50 bg-ai-bg/20" : "border-border bg-bg"
      }`}
      style={{
        height: depth,
        backgroundImage: "linear-gradient(rgba(244,244,245,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(244,244,245,0.03) 1px, transparent 1px)",
        backgroundSize: `${GRID}px ${GRID}px`,
      }}
    >
      {rooms.map((room) => {
        const tone = toneFor(room.kind);
        return (
          <div
            key={room.id}
            role={editing ? undefined : "button"}
            tabIndex={editing ? -1 : 0}
            onClick={() => { if (!editing && !dragRef.current) onOpen(room); }}
            onKeyDown={(event) => { if (!editing && event.key === "Enter") onOpen(room); }}
            onPointerDown={(event) => onPointerDown(event, room, "move")}
            className={`absolute rounded-xl border-2 select-none transition-shadow ${
              editing ? "cursor-grab active:cursor-grabbing" : "cursor-pointer hover:shadow-lg hover:shadow-black/40 focus:outline-none focus:ring-2 focus:ring-ai/60"
            }`}
            style={{ left: room.x, top: room.y, width: room.w, height: room.h, background: tone.fill, borderColor: tone.stroke }}
          >
            <div className="p-3 h-full flex flex-col pointer-events-none">
              <span className="text-sm font-semibold truncate" style={{ color: tone.text }}>{room.name}</span>
              {ROOM_KIND_LABELS[room.kind as RoomKind]?.toLowerCase() !== room.name.trim().toLowerCase() ? (
                <span className="text-[11px] text-ink-400 mt-0.5">
                  {ROOM_KIND_LABELS[room.kind as RoomKind] ?? room.kind}
                </span>
              ) : null}
              <span className="mt-auto text-[11px] text-ink-400 tabular-nums">
                {room.itemCount} item{room.itemCount === 1 ? "" : "s"}
              </span>
            </div>
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onRemove(room); }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full bg-panel border border-state-seated/50 text-state-seated text-xs leading-none hover:bg-state-seatedBg"
                  aria-label={`Remove ${room.name}`}
                >
                  ×
                </button>
                <div
                  onPointerDown={(event) => { event.stopPropagation(); onPointerDown(event, room, "resize"); }}
                  className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize"
                  style={{ background: `linear-gradient(135deg, transparent 50%, ${tone.stroke} 50%)`, borderBottomRightRadius: 10 }}
                  aria-hidden="true"
                />
              </>
            ) : null}
          </div>
        );
      })}

      {!rooms.length ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-ink-400 max-w-sm text-center px-6">
            {editing
              ? "Add your first room — the walk-in, dry storage, the bar — and drag it where it sits in the building."
              : "No rooms yet. Set them up under Settings → Edit inventory rooms."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
