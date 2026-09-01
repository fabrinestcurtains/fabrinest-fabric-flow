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
        <div className="font-semibold text-gold-900">Order Details</div>
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
                  className="h-8 bg-white"
                />
                <Button type="button" size="sm" onClick={saveEdit} className="h-8 bg-gold-700 hover:bg-gold-800 text-white">
                  <Check className="w-4 h-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-8">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 min-w-0">
                  <DoorOpen className="w-4 h-4 text-gold-900 shrink-0" />
                  <span className="font-semibold text-gold-900 truncate">{room.name}</span>
                  <span className="text-[10px] uppercase tracking-wider bg-white/70 text-gold-800 rounded-full px-2 py-0.5 shrink-0">
                    {room.windows.length} window{room.windows.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => startEdit(room)} className="p-1.5 rounded hover:bg-white/50" aria-label="Rename room">
                    <Pencil className="w-4 h-4 text-gold-900" />
                  </button>
                  <button type="button" onClick={() => deleteRoom(room.id)} className="p-1.5 rounded hover:bg-red-100" aria-label="Delete room">
                    <Trash2 className="w-4 h-4 text-red-600" />
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
                    <th className="text-left font-medium pb-1 pr-2">Window Name</th>
                    <th className="text-left font-medium pb-1 pr-2">Size</th>
                    <th className="text-left font-medium pb-1 pr-2">Style</th>
                    <th className="text-left font-medium pb-1 pr-2">Fabric</th>
                    <th className="text-left font-medium pb-1 pr-2">Note</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {room.windows.map((w) => (
                    <tr key={w.id}>
                      <td className="pr-2 py-1"><Input className="h-8" value={w.wname} onChange={(e) => updateWindow(room.id, w.id, { wname: e.target.value })} placeholder="e.g. Window 1" /></td>
                      <td className="pr-2 py-1"><Input className="h-8" value={w.size} onChange={(e) => updateWindow(room.id, w.id, { size: e.target.value })} placeholder="3m × 2.5m" /></td>
                      <td className="pr-2 py-1"><Input className="h-8" value={w.style} onChange={(e) => updateWindow(room.id, w.id, { style: e.target.value })} placeholder="Blackout / Sheer" /></td>
                      <td className="pr-2 py-1"><Input className="h-8" value={w.fabric} onChange={(e) => updateWindow(room.id, w.id, { fabric: e.target.value })} placeholder="Linen / Velvet" /></td>
                      <td className="pr-2 py-1"><Input className="h-8" value={w.note} onChange={(e) => updateWindow(room.id, w.id, { note: e.target.value })} placeholder="Optional..." /></td>
                      <td className="py-1 text-right">
                        {room.windows.length > 1 && (
                          <button type="button" onClick={() => deleteWindow(room.id, w.id)} className="p-1 rounded hover:bg-red-50" aria-label="Delete window">
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => addWindow(room.id)}
              className="w-full text-xs py-1.5 rounded border border-dashed border-gold-300 text-gold-700 hover:bg-gold-50 flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add Window Row
            </button>
          </div>
        </div>
      ))}

      {drafting ? (
        <div className={`rounded-lg border-2 border-dashed ${draftErr ? "border-red-400" : "border-gold-300"} p-2 flex items-center gap-2 bg-gold-50`}>
          <Input
            ref={draftRef}
            value={draftName}
            onChange={(e) => { setDraftName(e.target.value); if (draftErr) setDraftErr(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmDraft(); }
              if (e.key === "Escape") cancelDraft();
            }}
            placeholder="e.g. Living Room, Bedroom, Office..."
            className={`h-9 bg-white ${draftErr ? "border-red-400" : ""}`}
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
          className="w-full py-2.5 rounded-lg border-2 border-dashed border-gold-300 text-gold-700 hover:bg-gold-50 font-medium flex items-center justify-center gap-2"
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
