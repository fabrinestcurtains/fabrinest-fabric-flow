import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Pin, PinOff, StickyNote, Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase, type Note, type NoteColor } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/notes")({
  ssr: false,
  component: NotesPage,
});

const COLORS: { value: NoteColor; label: string; bg: string; swatch: string }[] = [
  { value: "default", label: "White", bg: "bg-white border-gold-200", swatch: "bg-white border-gold-300" },
  { value: "yellow",  label: "Yellow", bg: "bg-[#fffde7] border-yellow-200", swatch: "bg-[#fffde7] border-yellow-300" },
  { value: "blue",    label: "Blue",   bg: "bg-[#e3f2fd] border-blue-200",   swatch: "bg-[#e3f2fd] border-blue-300" },
  { value: "green",   label: "Green",  bg: "bg-[#e8f5e9] border-green-200",  swatch: "bg-[#e8f5e9] border-green-300" },
  { value: "pink",    label: "Pink",   bg: "bg-[#fce4ec] border-pink-200",   swatch: "bg-[#fce4ec] border-pink-300" },
];

const cardBg = (c: NoteColor) => COLORS.find((x) => x.value === c)?.bg ?? COLORS[0].bg;

function NotesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [dlg, setDlg] = useState<{ open: boolean; edit?: Note | null }>({ open: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);

  const notesQ = useQuery({
    queryKey: ["notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Note[];
    },
  });

  const filtered = useMemo(() => {
    const all = notesQ.data ?? [];
    if (!q.trim()) return all;
    const s = q.trim().toLowerCase();
    return all.filter(
      (n) => n.title.toLowerCase().includes(s) || (n.content ?? "").toLowerCase().includes(s),
    );
  }, [notesQ.data, q]);

  const pinned = filtered.filter((n) => n.is_pinned);
  const unpinned = filtered.filter((n) => !n.is_pinned);

  const togglePin = async (n: Note) => {
    const { error } = await supabase
      .from("notes")
      .update({ is_pinned: !n.is_pinned, updated_at: new Date().toISOString() })
      .eq("id", n.id);
    if (error) toast.error(error.message);
    else toast.success(n.is_pinned ? "Unpinned" : "Pinned");
    qc.invalidateQueries({ queryKey: ["notes"] });
  };

  const doDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("notes").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else toast.success("Note deleted");
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ["notes"] });
  };

  const hasAny = (notesQ.data ?? []).length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search notes..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button className="gold-gradient" onClick={() => setDlg({ open: true })}>
          <Plus className="w-4 h-4" /> Add Note
        </Button>
      </div>

      {notesQ.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-lg bg-white border border-gold-100 animate-pulse" />
          ))}
        </div>
      ) : !hasAny ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <StickyNote className="w-16 h-16 text-gold-400 mb-3" />
          <div className="text-lg font-bold text-gold-900">No notes yet</div>
          <div className="text-sm text-muted-foreground mb-4">
            Capture your thoughts, reminders and ideas
          </div>
          <Button className="gold-gradient" onClick={() => setDlg({ open: true })}>
            <Plus className="w-4 h-4" /> Add your first note
          </Button>
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <section className="space-y-3">
              {unpinned.length > 0 && (
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">📌 Pinned</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {pinned.map((n) => (
                  <NoteCard
                    key={n.id} note={n}
                    onOpen={() => setViewing(n)}
                    onEdit={() => setDlg({ open: true, edit: n })}
                    onDelete={() => setDeleteId(n.id)}
                    onPin={() => togglePin(n)}
                  />
                ))}
              </div>
            </section>
          )}
          {unpinned.length > 0 && (
            <section className="space-y-3">
              {pinned.length > 0 && (
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">All Notes</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {unpinned.map((n) => (
                  <NoteCard
                    key={n.id} note={n}
                    onOpen={() => setViewing(n)}
                    onEdit={() => setDlg({ open: true, edit: n })}
                    onDelete={() => setDeleteId(n.id)}
                    onPin={() => togglePin(n)}
                  />
                ))}
              </div>
            </section>
          )}
          {filtered.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">No notes match "{q}"</div>
          )}
        </>
      )}

      <NoteFormDialog
        open={dlg.open}
        onOpenChange={(v) => setDlg({ open: v })}
        editing={dlg.edit ?? null}
      />

      <NoteViewDialog
        note={viewing}
        onOpenChange={(v) => !v && setViewing(null)}
        onEdit={(n) => setDlg({ open: true, edit: n })}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-red-600 text-white hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NoteCard({
  note, onOpen, onEdit, onDelete, onPin,
}: { note: Note; onOpen: () => void; onEdit: () => void; onDelete: () => void; onPin: () => void }) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={`rounded-lg border p-3 flex flex-col min-h-[160px] cursor-pointer hover:shadow-[var(--shadow-card)] transition-shadow ${cardBg(note.color)}`}
    >
      <div className="font-semibold text-sm text-gray-900 line-clamp-2">{note.title}</div>
      {note.content && (
        <div className="text-[13px] text-gray-600 mt-1 whitespace-pre-wrap line-clamp-3 flex-1">
          {note.content}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-black/5">
        <div className="text-[11px] text-muted-foreground">{fmtDate(note.created_at)}</div>
        <div className="flex items-center gap-1">
          <button
            onClick={stop(onPin)}
            className="p-1.5 rounded hover:bg-black/5 min-w-[24px] min-h-[24px]"
            aria-label={note.is_pinned ? "Unpin" : "Pin"}
          >
            {note.is_pinned
              ? <Pin className="w-4 h-4 fill-gold-500 text-gold-600" />
              : <PinOff className="w-4 h-4 text-gray-400" />}
          </button>
          <button onClick={stop(onEdit)} className="p-1.5 rounded hover:bg-black/5" aria-label="Edit">
            <Pencil className="w-4 h-4 text-gold-600" />
          </button>
          <button onClick={stop(onDelete)} className="p-1.5 rounded hover:bg-red-100" aria-label="Delete">
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteViewDialog({
  note, onOpenChange, onEdit,
}: { note: Note | null; onOpenChange: (v: boolean) => void; onEdit: (n: Note) => void }) {
  const bg = note ? cardBg(note.color) : "";
  return (
    <Dialog open={!!note} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col p-0">
        {note && (
          <>
            <div className={`h-2 ${bg}`} />
            <div className="p-6 overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-xl">{note.title}</DialogTitle>
              </DialogHeader>
              <div className="text-xs text-muted-foreground mt-1">
                Created {fmtDate(note.created_at)}
              </div>
              <div className="mt-4 whitespace-pre-wrap text-sm text-gray-800">
                {note.content || <span className="text-muted-foreground">No content</span>}
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
                <Button className="gold-gradient" onClick={() => { onOpenChange(false); onEdit(note); }}>
                  <Pencil className="w-4 h-4" /> Edit
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteFormDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (v: boolean) => void; editing: Note | null }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState<NoteColor>("default");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setContent(editing?.content ?? "");
      setColor(editing?.color ?? "default");
      setPinned(editing?.is_pinned ?? false);
    }
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Title is required");
    setBusy(true);
    const payload = {
      title: title.trim(),
      content: content || null,
      color,
      is_pinned: pinned,
      updated_at: new Date().toISOString(),
    };
    const { error } = editing
      ? await supabase.from("notes").update(payload).eq("id", editing.id)
      : await supabase.from("notes").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Note updated" : "Note added");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["notes"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit Note" : "Add Note"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title..." required />
          </div>
          <div>
            <Label>Content</Label>
            <Textarea rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write your note here..." />
          </div>
          <div>
            <Label>Note color</Label>
            <div className="flex gap-2 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${c.swatch} ${
                    color === c.value ? "ring-2 ring-gold-500 ring-offset-2" : ""
                  }`}
                  aria-label={c.label}
                >
                  {color === c.value && <Check className="w-4 h-4 text-gold-700" />}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-gold-100 bg-gold-50 p-3">
            <Label className="mb-0">Pin this note</Label>
            <Switch checked={pinned} onCheckedChange={setPinned} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gold-gradient">
              {busy ? "Saving…" : "Save Note"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
