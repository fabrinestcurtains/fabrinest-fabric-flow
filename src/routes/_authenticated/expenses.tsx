import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase, logActivity, EXPENSE_CATEGORIES, type Expense, sanitizeSearch } from "@/lib/supabase";
import { fmtAED, fmtAEDShort, fmtDate, listMonthsSince, monthKey } from "@/lib/format";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { DatePickerField } from "@/components/date-picker-field";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { ChartErrorBoundary } from "@/components/chart-error-boundary";

export const Route = createFileRoute("/_authenticated/expenses")({
  ssr: false,
  component: ExpensesPage,
  validateSearch: (s: Record<string, unknown>) => ({ new: s.new === "1" || s.new === 1 ? "1" : undefined }),
});

const PAGE_SIZE = 10;

function ExpensesPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const search = Route.useSearch();
  const months = useMemo(() => listMonthsSince(2025), []);
  const [selected, setSelected] = useState(monthKey(new Date()));
  const selectedDate = months.find((m) => m.value === selected)!.date;
  const monthStart = format(startOfMonth(selectedDate), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(selectedDate), "yyyy-MM-dd");

  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<{ open: boolean; edit?: Expense | null }>({ open: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (search.new === "1") {
      setDlg({ open: true });
      nav({ to: "/expenses", search: { new: undefined }, replace: true });
    }
  }, [search.new, nav]);

  const monthSummaryQ = useQuery({
    queryKey: ["expenses-month-summary", selected],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("amount, expense_date")
        .gte("expense_date", monthStart)
        .lte("expense_date", monthEnd);
      return (data ?? []) as { amount: number; expense_date: string }[];
    },
  });

  const todayISO = format(new Date(), "yyyy-MM-dd");
  const isCurrent = selected === monthKey(new Date());
  const todayTotal = isCurrent
    ? (monthSummaryQ.data ?? []).filter((e) => e.expense_date === todayISO).reduce((s, e) => s + Number(e.amount), 0)
    : null;
  const monthTotal = (monthSummaryQ.data ?? []).reduce((s, e) => s + Number(e.amount), 0);
  const monthCount = (monthSummaryQ.data ?? []).length;

  const prevDate = subMonths(selectedDate, 1);
  const prevStart = format(startOfMonth(prevDate), "yyyy-MM-dd");
  const prevEnd = format(endOfMonth(prevDate), "yyyy-MM-dd");
  const prevQ = useQuery({
    queryKey: ["expenses-prev", monthKey(prevDate)],
    queryFn: async () => {
      const { data } = await supabase.from("expenses").select("amount").gte("expense_date", prevStart).lte("expense_date", prevEnd);
      return (data ?? []).reduce((s, e: any) => s + Number(e.amount), 0);
    },
  });

  const chart = useQuery({
    queryKey: ["expenses-chart", selected],
    queryFn: async () => {
      const months7: { key: string; label: string; total: number; date: Date }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = subMonths(selectedDate, i);
        months7.push({ key: monthKey(d), label: format(d, "MMM"), total: 0, date: d });
      }
      const start = format(startOfMonth(months7[0].date), "yyyy-MM-dd");
      const end = format(endOfMonth(months7[6].date), "yyyy-MM-dd");
      const { data } = await supabase.from("expenses").select("amount, expense_date").gte("expense_date", start).lte("expense_date", end);
      (data ?? []).forEach((e: any) => {
        const k = e.expense_date.slice(0, 7);
        const key = `${k}`;
        const m = months7.find((x) => x.key === key);
        if (m) m.total += Number(e.amount);
      });
      return months7;
    },
  });

  const expensesListQ = useQuery({
    queryKey: ["expenses-list-paged", selected, debouncedQ, page],
    queryFn: async () => {
      let query = supabase
        .from("expenses")
        .select("*", { count: "exact" })
        .gte("expense_date", monthStart)
        .lte("expense_date", monthEnd)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      const s = sanitizeSearch(debouncedQ);
      if (s) {
        query = query.or(`title.ilike.%${s}%,category.ilike.%${s}%`);
      }

      query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as Expense[], total: count ?? 0 };
    },
  });

  const total = expensesListQ.data?.total ?? 0;
  const paged = expensesListQ.data?.rows ?? [];

  useEffect(() => setPage(1), [selected, debouncedQ]);

  const doDelete = async () => {
    if (!deleteId) return;
    const expense = paged.find((e) => e.id === deleteId);
    const { error } = await supabase.from("expenses").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else {
      toast.success("Expense deleted");
      await logActivity(
        "expense_deleted",
        "Expense deleted",
        undefined,
        expense
          ? `${expense.title} · ${expense.category} · AED ${Number(expense.amount).toLocaleString()}`
          : "Entry removed",
      );
    }
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
    qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <h2 className="text-lg font-bold text-gold-900">{months.find((m) => m.value === selected)?.label} Expense Overview</h2>

      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <StatCard label="This Month" value={fmtAED(monthTotal)} sub={`${monthCount} expenses`} tone="gold" />
        <StatCard label="Today" value={todayTotal == null ? "—" : fmtAED(todayTotal)} sub={todayTotal == null ? "Past month" : "So far today"} tone="blue" />
        <StatCard label="Last Month" value={fmtAED(prevQ.data ?? 0)} sub={format(prevDate, "MMM yyyy")} tone="muted" />
        <button
          onClick={() => setDlg({ open: true })}
          className="rounded-xl gold-gradient text-white p-4 flex flex-col items-start justify-between min-h-[120px] hover:opacity-90"
        >
          <Plus className="w-8 h-8" />
          <div>
            <div className="font-semibold">Add New Expense</div>
            <div className="text-xs opacity-80">Record a new business expense</div>
          </div>
        </button>
      </div>

      <div className="bg-white border border-gold-100 rounded-xl p-4">
        <div className="font-semibold text-gold-900 mb-3">Expenses Over Time (7 months)</div>
        <div className="h-56">
          <ChartErrorBoundary>
            {!(chart.data && chart.data.length > 0) ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No expense history available</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.data ?? []}>
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
                  <Tooltip formatter={(v: number) => fmtAED(v)} cursor={{ fill: "rgba(193,158,101,0.1)" }} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                    {(chart.data ?? []).map((entry) => (
                      <Cell key={entry.key} fill={entry.key === selected ? "#c19e65" : "#e8d0a8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartErrorBoundary>
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search expenses by title or category…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="text-xs text-muted-foreground">
        {expensesListQ.isLoading
          ? "Loading expenses…"
          : `Showing ${paged.length} of ${expensesListQ.data?.total ?? 0} expenses ${debouncedQ ? `for "${debouncedQ}"` : ""}`.trim()}
      </div>

      <div className="bg-white border border-gold-100 rounded-xl">
        {expensesListQ.isLoading ? (
          <div className="p-6 text-center text-muted-foreground">Loading…</div>
        ) : total === 0 ? (
          <EmptyState icon={<Wallet className="w-10 h-10" />} title="No expenses for this month" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gold-50 text-gold-800">
                  <tr>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Title</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((e) => (
                    <tr key={e.id} className="border-t border-gold-100">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.expense_date)}</td>
                      <td className="px-3 py-2">{e.title}</td>
                      <td className="px-3 py-2"><span className={`inline-flex px-2 py-0.5 rounded-full border text-xs ${e.category.startsWith("Others") ? "bg-gray-100 border-gray-200 text-gray-700" : "bg-gold-50 border-gold-100"}`}>{e.category}</span></td>
                      <td className="px-3 py-2 text-right font-medium">{fmtAED(e.amount)}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{e.description || "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button className="p-1.5 hover:bg-gold-50 rounded" onClick={() => setDlg({ open: true, edit: e })} aria-label="Edit"><Pencil className="w-4 h-4 text-gold-600" /></button>
                        <button className="p-1.5 hover:bg-red-50 rounded" onClick={() => setDeleteId(e.id)} aria-label="Delete"><Trash2 className="w-4 h-4 text-red-500" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3"><Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} /></div>
          </>
        )}
      </div>

      <ExpenseFormDialog
        open={dlg.open}
        onOpenChange={(v) => setDlg({ open: v })}
        editing={dlg.edit ?? null}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
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

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "gold" | "blue" | "muted" }) {
  const map = {
    gold: "bg-white border-gold-100 text-gold-900",
    blue: "bg-white border-blue-100 text-blue-800",
    muted: "bg-white border-gold-100 text-gold-800",
  } as const;
  return (
    <div className={`rounded-xl border p-4 min-h-[120px] flex flex-col justify-between ${map[tone]}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>
        <div className="text-xl md:text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function ExpenseFormDialog({
  open, onOpenChange, editing,
}: { open: boolean; onOpenChange: (v: boolean) => void; editing: Expense | null }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Others");
  const [othersText, setOthersText] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState<string | null>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setAmount(editing ? String(editing.amount) : "");
      const cat = editing?.category ?? "Others";
      if (cat.startsWith("Others - ")) {
        setCategory("Others");
        setOthersText(cat.slice("Others - ".length));
      } else if (cat === "Miscellaneous") {
        setCategory("Others");
        setOthersText("");
      } else {
        setCategory(cat);
        setOthersText("");
      }
      setDate(editing?.expense_date ?? format(new Date(), "yyyy-MM-dd"));
      setDescription(editing?.description ?? "");
    }
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount || !date) return toast.error("Fill required fields");
    if (category === "Others" && !othersText.trim()) return toast.error("Please specify the 'Others' category");
    setBusy(true);
    const finalCategory = category === "Others" ? `Others - ${othersText.trim()}` : category;
    const payload = { title, amount: Number(amount), category: finalCategory, expense_date: date, description: description || null };
    const { error } = editing
      ? await supabase.from("expenses").update(payload).eq("id", editing.id)
      : await supabase.from("expenses").insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Expense updated" : "Expense added");
    await logActivity(
      editing ? "expense_edited" : "expense_created",
      editing ? "Expense updated" : "New expense added",
      editing?.id,
      `${payload.category} · AED ${Number(payload.amount).toLocaleString()}`,
    );
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["expenses-month"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
    qc.invalidateQueries({ queryKey: ["expenses-prev"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit Expense" : "Add New Expense"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Title *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office Rent July 2026" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (AED) *</Label>
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label>Date *</Label>
              <DatePickerField value={date} onChange={setDate} />
            </div>
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {category === "Others" && (
            <div>
              <Label>Please specify *</Label>
              <Input
                value={othersText}
                onChange={(e) => setOthersText(e.target.value)}
                placeholder="e.g. Fabric samples, Client gift..."
                required
              />
            </div>
          )}
          <div>
            <Label>Description</Label>
            <Textarea rows={3} value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gold-gradient">{busy ? "Saving…" : "Save Expense"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
