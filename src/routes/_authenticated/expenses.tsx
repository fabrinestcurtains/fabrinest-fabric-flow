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

const EXPENSE_CAT_COLORS: Record<string, string> = {
  "Raw Materials & Fabric": "#8B5A2B",
  "Fixing Man": "#C9A86A",
  "Transport & Delivery": "#D4B896",
  "Marketing & Advertising": "#A8C3A0",
  "Rent / Showroom": "#7c3aed",
  "Staff Salary": "#0ea5e9",
  "Tools & Equipment": "#f59e0b",
  "Labour": "#ec4899",
  "Others": "#94a3b8",
};

const DEFAULT_FALLBACK_COLORS = [
  "#8B5A2B",
  "#C9A86A",
  "#D4B896",
  "#A8C3A0",
  "#7c3aed",
  "#0ea5e9",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#94a3b8",
];

function getCategoryColor(cat: string, index: number = 0): string {
  if (EXPENSE_CAT_COLORS[cat]) return EXPENSE_CAT_COLORS[cat];
  if (cat.startsWith("Others")) return "#94a3b8";
  return DEFAULT_FALLBACK_COLORS[index % DEFAULT_FALLBACK_COLORS.length];
}

function CategoryBadge({ category, className = "" }: { category: string; className?: string }) {
  const isOthers = category.startsWith("Others");
  return (
    <span
      title={category}
      style={{ whiteSpace: "nowrap" }}
      className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium border shrink-0 ${
        isOthers
          ? "bg-gray-100 border-gray-200 text-gray-700"
          : "bg-gold-50 border-gold-100 text-gold-800"
      } ${className}`}
    >
      <span className="truncate">{category}</span>
    </span>
  );
}

function ExpensesPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const search = Route.useSearch();
  const months = useMemo(() => listMonthsSince(2025), []);
  const [selected, setSelected] = useState(monthKey(new Date()));
  const selectedDate = months.find((m) => m.value === selected)!.date;
  const monthLabel = months.find((m) => m.value === selected)?.label ?? "";
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

  const breakdownQ = useQuery({
    queryKey: ["expenses-breakdown", selected],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("amount, category")
        .gte("expense_date", monthStart)
        .lte("expense_date", monthEnd);
      const rows = (data ?? []) as { amount: number; category: string }[];
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      const byCat: Record<string, number> = {};
      rows.forEach((r) => {
        byCat[r.category] = (byCat[r.category] ?? 0) + Number(r.amount);
      });
      return { total, byCat };
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
        expense ? `Expense deleted: ${fmtAED(Number(expense.amount))} - ${expense.title} (${expense.category})` : "Expense deleted",
        undefined,
        expense
          ? `${expense.title} · ${expense.category} · ${fmtAED(Number(expense.amount))}`
          : "Entry removed",
      );
    }
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
    qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
    qc.invalidateQueries({ queryKey: ["expenses-breakdown"] });
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

      {/* Expense Breakdown */}
      <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5">
        <div className="flex items-start justify-between gap-[10px] mb-3.5">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-gold-900 text-xs min-[400px]:text-sm sm:text-base leading-snug">
              Expense Breakdown — {monthLabel}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Category wise spending analysis</div>
          </div>
          {/* Desktop badge */}
          <span className="hidden md:inline-flex text-xs font-semibold bg-gold-50 text-gold-700 border border-gold-200 px-3 py-1 rounded-full whitespace-nowrap shrink-0">
            Total {fmtAED(breakdownQ.data?.total ?? 0)}
          </span>
          {/* Mobile badge */}
          <span
            className="md:hidden inline-flex items-center whitespace-nowrap shrink-0 rounded-full bg-[#FFFBF2] border border-gold-100 text-gold-700 font-semibold text-[11px]"
            style={{ padding: "4px 10px", lineHeight: 1, whiteSpace: "nowrap" }}
          >
            {fmtAED(breakdownQ.data?.total ?? 0).replace(" ", "\u00A0")} total
          </span>
        </div>

        {breakdownQ.isLoading ? (
          <div className="text-xs text-muted-foreground py-4 text-center">Loading breakdown…</div>
        ) : Object.keys(breakdownQ.data?.byCat ?? {}).length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">No expenses recorded.</div>
        ) : (
          <>
            {/* Mobile version (demo style) */}
            <div className="md:hidden space-y-3">
              {Object.entries(breakdownQ.data!.byCat)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amt], i) => {
                  const p = breakdownQ.data!.total ? (amt / breakdownQ.data!.total) * 100 : 0;
                  const color = getCategoryColor(cat, i);
                  return (
                    <div key={cat} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span
                            className="rounded-full shrink-0"
                            style={{ backgroundColor: color, width: "8px", height: "8px" }}
                          />
                          <span
                            className="font-semibold text-gold-950 truncate text-[12.5px] leading-tight"
                            title={cat}
                          >
                            {cat}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1.5 shrink-0 whitespace-nowrap">
                          <span className="font-bold text-gold-900 text-[12.5px] leading-tight">
                            {fmtAED(amt).replace(" ", "\u00A0")}
                          </span>
                          <span className="text-[11px] text-muted-foreground leading-tight">
                            ({p.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      <div className="h-[6px] w-full rounded-full bg-[#F0E6D6] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, p))}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Desktop version (same as Reports desktop) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="bg-gold-50 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-right px-3 py-2 font-medium">% Share</th>
                    <th className="text-left px-3 py-2 font-medium w-[35%]">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(breakdownQ.data!.byCat)
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, amt], i) => {
                      const p = breakdownQ.data!.total ? (amt / breakdownQ.data!.total) * 100 : 0;
                      const color = getCategoryColor(cat, i);
                      return (
                        <tr key={cat} className="border-t border-gold-50">
                          <td className="px-3 py-2 text-gold-900">{cat}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmtAED(amt)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{p.toFixed(1)}%</td>
                          <td className="px-3 py-2">
                            <div className="h-2 rounded-full bg-gold-50 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  <tr className="border-t-2 border-gold-200 bg-gold-50/40">
                    <td className="px-3 py-2 font-bold text-gold-900">TOTAL</td>
                    <td className="px-3 py-2 text-right font-bold text-gold-700">{fmtAED(breakdownQ.data!.total)}</td>
                    <td className="px-3 py-2 text-right font-bold">100%</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
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
            {/* Mobile Card System */}
            <div className="md:hidden flex flex-col gap-2.5 p-2">
              {paged.map((e) => (
                <div
                  key={e.id}
                  className="bg-white border border-gold-100 rounded-xl p-3 shadow-sm space-y-2 hover:bg-gold-50/40 transition-colors"
                >
                  {/* Top row: Date left + Amount right */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                      {fmtDate(e.expense_date)}
                    </span>
                    <span
                      className="font-bold text-gold-900 text-sm whitespace-nowrap"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {fmtAED(e.amount).replace(" ", "\u00A0")}
                    </span>
                  </div>

                  {/* Middle row: Title left + Category badge right */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-gold-950 truncate min-w-0 flex-1">
                      {e.title}
                    </span>
                    <CategoryBadge category={e.category} className="max-w-[120px]" />
                  </div>

                  {/* Bottom row: Description (if exists) */}
                  {e.description && (
                    <div className="text-xs text-muted-foreground">
                      {e.description}
                    </div>
                  )}

                  {/* Actions row: Edit/Delete right aligned */}
                  <div className="flex items-center justify-end gap-1 pt-1.5 border-t border-gold-50">
                    <button
                      type="button"
                      className="p-1.5 hover:bg-gold-100 rounded text-gold-700 transition-colors"
                      onClick={() => setDlg({ open: true, edit: e })}
                      aria-label="Edit"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5 text-gold-600" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors"
                      onClick={() => setDeleteId(e.id)}
                      aria-label="Delete"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm border-collapse">
                <thead className="bg-gold-50/70 text-gold-900 border-b border-gold-100">
                  <tr className="text-[10px] uppercase tracking-wider font-semibold">
                    <th className="text-left px-4 py-3 w-[110px] whitespace-nowrap">Date</th>
                    <th className="text-left px-4 py-3 min-w-[120px]">Title</th>
                    <th className="text-center px-4 py-3 whitespace-nowrap">Category</th>
                    <th className="text-right px-4 py-3 whitespace-nowrap min-w-[90px]">Amount</th>
                    <th className="text-left px-4 py-3 min-w-[140px]">Description</th>
                    <th className="text-right px-4 py-3 w-[70px] whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gold-50">
                  {paged.map((e) => (
                    <tr key={e.id} className="hover:bg-gold-50/40 transition-colors">
                      <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground font-medium align-middle w-[110px]">
                        {fmtDate(e.expense_date)}
                      </td>
                      <td className="px-4 py-3.5 align-middle min-w-[120px]">
                        <div className="font-semibold text-gold-950 text-xs">{e.title}</div>
                      </td>
                      <td className="px-4 py-3.5 text-center whitespace-nowrap align-middle">
                        <div className="flex justify-center">
                          <CategoryBadge category={e.category} />
                        </div>
                      </td>
                      <td
                        className="text-right font-bold whitespace-nowrap px-4 py-3.5 text-gold-900 text-xs align-middle min-w-[90px]"
                        style={{ whiteSpace: "nowrap", minWidth: "90px" }}
                      >
                        {fmtAED(e.amount).replace(" ", "\u00A0")}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground max-w-xs truncate align-middle" title={e.description || undefined}>
                        {e.description || "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap align-middle w-[70px]">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="p-1.5 hover:bg-gold-100 rounded text-gold-700 transition-colors"
                            onClick={() => setDlg({ open: true, edit: e })}
                            aria-label="Edit"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5 text-gold-600" />
                          </button>
                          <button
                            type="button"
                            className="p-1.5 hover:bg-red-50 rounded text-red-600 transition-colors"
                            onClick={() => setDeleteId(e.id)}
                            aria-label="Delete"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </div>
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
    const expTitle = editing
      ? `Expense updated: ${fmtAED(payload.amount)} - ${payload.title} (${payload.category})`
      : `Expense ${fmtAED(payload.amount)} - ${payload.title} (${payload.category})`;
    const expDesc = `Category: ${payload.category}, Amount: ${fmtAED(payload.amount)}${payload.description ? `, Note: ${payload.description}` : ""}`;
    await logActivity(
      editing ? "expense_edited" : "expense_created",
      expTitle,
      editing?.id,
      expDesc,
    );
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["expenses-month"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
    qc.invalidateQueries({ queryKey: ["expenses-prev"] });
    qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
    qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
    qc.invalidateQueries({ queryKey: ["expenses-breakdown"] });
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
