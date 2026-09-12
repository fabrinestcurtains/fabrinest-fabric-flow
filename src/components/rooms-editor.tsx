import { Fragment, useEffect, useRef, useState } from "react";
import { ClipboardList, DoorOpen, Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type WindowRow = {
  id: string;
  wname: string;
  size: string;
  style: string;
  fabric: string;
  note: string;
};

export type Room = {
  id: string;
  name: string;
  windows: WindowRow[];
};

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const emptyWindow = (): WindowRow => ({
  id: uid(),
  wname: "",
  size: "",
  style: "",
  fabric: "",
  note: "",
});

export function newRoom(name = ""): Room {
  return { id: uid(), name, windows: [emptyWindow()] };
}

export function RoomsEditor({
  value,
  onChange,
}: {
  value: Room[];
  onChange: (v: Room[]) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftErr, setDraftErr] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (drafting) draftRef.current?.focus();
  }, [drafting]);
  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  const updateRoom = (id: string, patch: Partial<Room>) =>
    onChange(value.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateWindow = (rid: string, wid: string, patch: Partial<WindowRow>) =>
    onChange(
      value.map((r) =>
        r.id === rid ? { ...r, windows: r.windows.map((w) => (w.id === wid ? { ...w, ...patch } : w)) } : r,
      ),
    );
  const deleteRoom = (id: string) => onChange(value.filter((r) => r.id !== id));
  const addWindow = (rid: string) =>
    onChange(value.map((r) => (r.id === rid ? { ...r, windows: [...r.windows, emptyWindow()] } : r)));
  const deleteWindow = (rid: string, wid: string) =>
    onChange(
      value.map((r) =>
        r.id === rid && r.windows.length > 1
          ? { ...r, windows: r.windows.filter((w) => w.id !== wid) }
          : r,
      ),
    );

  const confirmDraft = () => {
    const n = draftName.trim();
    if (!n) return setDraftErr(true);
    onChange([...value, newRoom(n)]);
    setDrafting(false);
    setDraftName("");
    setDraftErr(false);
  };
  const cancelDraft = () => {
    setDrafting(false);
    setDraftName("");
    setDraftErr(false);
  };
  const startEdit = (r: Room) => {
    setEditingId(r.id);
    setEditName(r.name);
  };
  const saveEdit = () => {
    if (!editingId) return;
    const n = editName.trim();
    if (n) updateRoom(editingId, { name: n });
    setEditingId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-gold-700" />
        <div className="font-semibold text-gold-900">
          Order Details{value.length > 0 ? ` — ${value.length} room${value.length !== 1 ? "s" : ""}` : ""}
        </div>
      </div>

      {value.map((room) => (
        <div key={room.id} className="rounded-lg border border-gold-200 overflow-hidden bg-white">
          <div className="flex items-center justify-between gap-2 px-3 py-2 gold-gradient">
            {editingId === room.id ? (
              <div className="flex items-center gap-2 w-full">
                <Input
                  ref={editRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-8 bg-white text-foreground"
                />
                <Button type="button" size="sm" onClick={saveEdit} className="h-8 bg-white/20 hover:bg-white/30 text-white">
                  <Check className="w-4 h-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8 text-white hover:bg-white/20 hover:text-white">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <DoorOpen className="w-4 h-4 text-white shrink-0" />
                  <span className="font-semibold text-white truncate">{room.name}</span>
                  <span className="text-[10px] uppercase tracking-wider bg-white/20 text-white rounded-full px-2 py-0.5 shrink-0 font-medium">
                    {room.windows.length} window{room.windows.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(room)}
                    className="w-7 h-7 rounded-md bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                    aria-label="Rename room"
                    title="Rename room"
                  >
                    <Pencil className="w-4 h-4 text-white" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRoom(room.id)}
                    className="w-7 h-7 rounded-md bg-white/20 hover:bg-red-500/20 flex items-center justify-center transition-colors group"
                    aria-label="Delete room"
                    title="Delete room"
                  >
                    <Trash2 className="w-4 h-4 text-white group-hover:text-red-200" />
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="p-3 space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[600px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-medium pb-1 pr-2">Window Name *</th>
                    <th className="text-left font-medium pb-1 pr-2">Size *</th>
                    <th className="text-left font-medium pb-1 pr-2">Style</th>
                    <th className="text-left font-medium pb-1 pr-2">Fabric</th>
                    <th className="text-left font-medium pb-1 pr-2">Note</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {room.windows.map((w) => {
                    const isPartiallyFilled =
                      Boolean(w.wname?.trim() || w.size?.trim() || w.style?.trim() || w.fabric?.trim() || w.note?.trim()) &&
                      (!w.wname?.trim() || !w.size?.trim());
                    return (
                      <tr key={w.id} className={isPartiallyFilled ? "bg-red-50/50 rounded" : ""}>
                        <td className="pr-2 py-1">
                          <Input
                            className={`h-8 ${isPartiallyFilled && !w.wname?.trim() ? "border-red-400 focus-visible:ring-red-400 bg-red-50/30" : ""}`}
                            value={w.wname}
                            onChange={(e) => updateWindow(room.id, w.id, { wname: e.target.value })}
                            placeholder="e.g. Window 1"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <Input
                            className={`h-8 ${isPartiallyFilled && !w.size?.trim() ? "border-red-400 focus-visible:ring-red-400 bg-red-50/30" : ""}`}
                            value={w.size}
                            onChange={(e) => updateWindow(room.id, w.id, { size: e.target.value })}
                            placeholder="3m × 2.5m"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <Input
                            className="h-8"
                            value={w.style}
                            onChange={(e) => updateWindow(room.id, w.id, { style: e.target.value })}
                            placeholder="Blackout / Sheer"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <Input
                            className="h-8"
                            value={w.fabric}
                            onChange={(e) => updateWindow(room.id, w.id, { fabric: e.target.value })}
                            placeholder="Linen / Velvet"
                          />
                        </td>
                        <td className="pr-2 py-1">
                          <Input
                            className="h-8"
                            value={w.note}
                            onChange={(e) => updateWindow(room.id, w.id, { note: e.target.value })}
                            placeholder="Optional..."
                          />
                        </td>
                        <td className="py-1 text-right">
                          {room.windows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteWindow(room.id, w.id)}
                              className="w-7 h-7 rounded-md hover:bg-stone-100 flex items-center justify-center text-stone-500 hover:text-stone-800 transition-colors ml-auto"
                              aria-label="Delete window"
                              title="Delete window"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => addWindow(room.id)}
              className="w-full h-9 border border-dashed border-gold-200 rounded-lg bg-white hover:bg-gold-50 text-gold-600 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Window Row
            </button>
          </div>
        </div>
      ))}

      {drafting ? (
        <div className={`rounded-xl border-2 border-dashed ${draftErr ? "border-red-400" : "border-gold-300"} p-2.5 flex items-center gap-2 bg-gold-50/50`}>
          <Input
            ref={draftRef}
            value={draftName}
            onChange={(e) => { setDraftName(e.target.value); if (draftErr) setDraftErr(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmDraft(); }
              if (e.key === "Escape") cancelDraft();
            }}
            placeholder="e.g. Living Room, Bedroom, Office..."
            className={`h-9 bg-white ${draftErr ? "border-red-400" : "border-gold-200"}`}
          />
          <Button type="button" size="sm" onClick={confirmDraft} className="h-9 gold-gradient">OK</Button>
          <Button type="button" size="sm" variant="ghost" onClick={cancelDraft} className="h-9">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDrafting(true)}
          className="w-full h-11 border-2 border-dashed border-gold-300 rounded-xl bg-gold-50/50 hover:bg-gold-50 text-gold-700 font-medium text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Room
        </button>
      )}
    </div>
  );
}

export function RoomsDisplay({
  rooms,
  additionalInfo,
  legacyDetails,
}: {
  rooms: Room[] | null | undefined;
  additionalInfo?: string | null;
  legacyDetails?: string | null;
}) {
  const hasRooms = Array.isArray(rooms) && rooms.length > 0;

  if (!hasRooms && legacyDetails?.trim()) {
    return (
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Details</div>
        <pre className="whitespace-pre-wrap text-sm bg-gold-50 border border-gold-100 rounded-md p-3 font-sans">
          {legacyDetails}
        </pre>
      </div>
    );
  }

  if (!hasRooms && !additionalInfo?.trim()) {
    return <div className="text-sm text-muted-foreground">—</div>;
  }

  return (
    <div className="space-y-3">
      {hasRooms && rooms!.map((r) => (
        <div key={r.id} className="border-l-2 border-gold-400 pl-3">
          <div className="font-semibold text-gold-700 text-sm mb-1">{r.name}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[400px]">
              <thead>
                <tr className="text-[10px] uppercase text-muted-foreground">
                  <th className="text-left font-medium pb-1 pr-2">Window</th>
                  <th className="text-left font-medium pb-1 pr-2">Size</th>
                  <th className="text-left font-medium pb-1 pr-2">Style</th>
                  <th className="text-left font-medium pb-1 pr-2">Fabric</th>
                </tr>
              </thead>
              <tbody>
                {r.windows.map((w) => (
                  <Fragment key={w.id}>
                    <tr className="border-t border-gold-50">
                      <td className="pr-2 py-1">{w.wname || "—"}</td>
                      <td className="pr-2 py-1">{w.size || "—"}</td>
                      <td className="pr-2 py-1">{w.style || "—"}</td>
                      <td className="pr-2 py-1">{w.fabric || "—"}</td>
                    </tr>
                    {w.note?.trim() && (
                      <tr>
                        <td colSpan={4} className="pl-2 pb-1 text-[11px] italic text-muted-foreground">
                          ↳ {w.note}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {additionalInfo?.trim() && (
        <div className="rounded-md bg-gold-50 border border-gold-100 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Additional Info</div>
          <div className="text-sm whitespace-pre-wrap">{additionalInfo}</div>
        </div>
      )}
    </div>
  );
}
