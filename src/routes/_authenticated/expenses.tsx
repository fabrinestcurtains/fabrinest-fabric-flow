import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Inbox, Wallet, Eye, ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, startOfMonth, endOfMonth, subMonths, subDays, parseISO, isValid } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
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
import { supabase, logActivity, EXPENSE_CATEGORIES, type Expense, sanitizeSearch, generateExpenseCode } from "@/lib/supabase";
import { fmtAED, fmtAEDShort, fmtDate, listMonthsSince, monthKey, getDubaiNow } from "@/lib/format";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { DatePickerField } from "@/components/date-picker-field";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { ChartErrorBoundary } from "@/components/chart-error-boundary";
import { ExpenseDetailSheet, ExpenseCategoryBadge } from "@/components/expense-detail-sheet";
import { ExpenseFormDialog } from "@/components/expense-form-dialog";

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

function formatDateHeader(dateStr: string): string {
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
    const d = isDateOnly ? parseISO(dateStr.trim()) : new Date(dateStr);
    if (!isValid(d)) return dateStr;
    const formattedDate = formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy");

    const dNow = getDubaiNow();
    const todayStr = format(dNow, "yyyy-MM-dd");
    const yesterdayStr = format(subDays(dNow, 1), "yyyy-MM-dd");
    const targetDateStr = isDateOnly
      ? dateStr.trim()
      : formatInTimeZone(d, "Asia/Dubai", "yyyy-MM-dd");

    if (targetDateStr === todayStr) {
      return `Today — ${formattedDate}`;
    }
    if (targetDateStr === yesterdayStr) {
      return `Yesterday — ${formattedDate}`;
    }
    return formattedDate;
  } catch {
    return dateStr;
  }
}

const CategoryBadge = ExpenseCategoryBadge;

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
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});

  const toggleCollapseDate = (dateStr: string) => {
    setCollapsedDates((prev) => ({
      ...prev,
      [dateStr]: !prev[dateStr],
    }));
  };

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
        query = query.or(
          `title.ilike.%${s}%,category.ilike.%${s}%,expense_code.ilike.%${s}%,description.ilike.%${s}%`
        );
      }

      query = query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as Expense[], total: count ?? 0 };
    },
  });

  const total = expensesListQ.data?.total ?? 0;
  const paged = expensesListQ.data?.rows ?? [];

  const groupedByDate = useMemo(() => {
    const map = new Map<string, { totalAmount: number; items: Expense[] }>();

    for (const item of paged) {
      const rawDate = item.expense_date;
      const date = rawDate ? new Date(rawDate) : null;
      const d =
        date && isValid(date)
          ? formatInTimeZone(date, "Asia/Dubai", "yyyy-MM-dd")
          : rawDate || "Unknown";

      if (!map.has(d)) {
        map.set(d, { totalAmount: 0, items: [] });
      }
      const g = map.get(d)!;
      g.totalAmount += Number(item.amount) || 0;
      g.items.push(item);
    }

    return Array.from(map.entries()).map(([date, val]) => ({
      date,
      totalAmount: val.totalAmount,
      items: val.items,
    }));
  }, [paged]);

  useEffect(() => setPage(1), [selected, debouncedQ]);

  const doDelete = async () => {
    if (!deleteId) return;
    const expense = paged.find((e) => e.id === deleteId);
    const { error } = await supabase.from("expenses").delete().eq("id", deleteId);
    if (error) toast.error(error.message);
    else {
      toast.success("Expense deleted");
      const expCode = (expense?.expense_code || expense?.id || "").replace(/^#/, "").trim();
      await logActivity(
        "expense_deleted",
        expense ? `Expense deleted: ${fmtAED(Number(expense.amount))} - ${expense.title} (${expense.category})` : "Expense deleted",
        expCode || undefined,
        expense
          ? `${expense.category} · ${fmtAED(Number(expense.amount))}${expCode ? ` - ${expCode}` : ""}`
          : "Entry removed",
      );
    }
    setDeleteId(null);
    setSelectedExpense(null);
    qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
    qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
    qc.invalidateQueries({ queryKey: ["expenses-month"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
    qc.invalidateQueries({ queryKey: ["expenses-breakdown"] });
    qc.invalidateQueries({ queryKey: ["expenses-lookup-logs"] });
    qc.invalidateQueries({ queryKey: ["activity-logs"] });
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
        <Input placeholder="Search expenses by title, category, or ID (#EXP)…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="text-xs text-muted-foreground">
        {expensesListQ.isLoading
          ? "Loading expenses…"
          : `Showing ${paged.length} of ${expensesListQ.data?.total ?? 0} expenses ${debouncedQ ? `for "${debouncedQ}"` : ""}`.trim()}
      </div>

      <div className="space-y-4">
        {expensesListQ.isLoading ? (
          <div className="bg-white border border-gold-100 rounded-xl p-8 text-center text-sm text-muted-foreground">
            Loading expenses…
          </div>
        ) : total === 0 ? (
          <div className="bg-white border border-gold-100 rounded-xl p-8">
            <EmptyState
              icon={
                debouncedQ ? (
                  <Search className="w-10 h-10 text-gold-400" />
                ) : (
                  <Inbox className="w-10 h-10 text-gold-400" />
                )
              }
              title={debouncedQ ? "No expenses found matching your search" : "No expenses for this month"}
              description={debouncedQ ? "Try clearing your search keyword or ID." : undefined}
              action={
                debouncedQ ? (
                  <Button variant="outline" size="sm" onClick={() => setQ("")}>
                    Reset Search
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            {groupedByDate.map((group) => {
              const isCollapsed = !!collapsedDates[group.date];

              return (
                <div
                  key={group.date}
                  className="bg-white border border-gold-100 rounded-xl overflow-hidden shadow-xs"
                >
                  {/* Collapsible Date Header: all expanded by default, total green right */}
                  <button
                    type="button"
                    onClick={() => toggleCollapseDate(group.date)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gold-50/70 border-b border-gold-100 hover:bg-gold-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gold-700 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gold-700 shrink-0" />
                      )}
                      <span className="font-semibold text-gold-900 text-sm">
                        {formatDateHeader(group.date)}
                      </span>
                      <span className="text-sm text-gold-700 font-medium">
                        — Total {fmtAED(group.totalAmount)}
                      </span>
                      <span className="text-xs text-muted-foreground font-normal">
                        ({group.items.length} {group.items.length === 1 ? "expense" : "expenses"})
                      </span>
                    </div>

                    <div className="text-right hidden sm:block">
                      <span className="font-bold text-emerald-700 text-sm">
                        {fmtAED(group.totalAmount)}
                      </span>
                    </div>
                  </button>

                  {/* Content when expanded */}
                  {!isCollapsed && (
                    <>
                      {/* Mobile Card System */}
                      <div className="md:hidden space-y-2.5 p-3">
                        {group.items.map((e) => {
                          const expCode = e.expense_code
                            ? `#${e.expense_code}`
                            : `#${e.id.slice(0, 8)}`;
                          return (
                            <div
                              key={e.id}
                              onClick={() => setSelectedExpense(e)}
                              className="bg-white border border-gold-100 rounded-xl p-3 shadow-xs space-y-2 hover:bg-gold-50/40 transition-colors cursor-pointer"
                            >
                              {/* Top row: Date + Amount */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                                    {fmtDate(e.expense_date)}
                                  </span>
                                  <span className="font-mono text-[11px] font-bold text-gold-800 bg-gold-50 border border-gold-200 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">
                                    {expCode}
                                  </span>
                                </div>
                                <span className="font-bold text-emerald-600 text-sm whitespace-nowrap">
                                  {fmtAED(e.amount).replace(" ", "\u00A0")}
                                </span>
                              </div>

                              {/* Middle row: Title + Category badge single line nowrap */}
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-sm text-gold-950 truncate min-w-0 flex-1">
                                  {e.title}
                                </span>
                                <ExpenseCategoryBadge
                                  category={e.category}
                                  className="shrink-0 max-w-[130px]"
                                />
                              </div>

                              {/* Description (if exists) */}
                              {e.description && (
                                <div className="text-xs text-muted-foreground line-clamp-2">
                                  {e.description}
                                </div>
                              )}

                              {/* Actions row: right aligned 36px touch */}
                              <div
                                className="flex items-center justify-end gap-1 pt-1.5 border-t border-gold-50"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="w-9 h-9 flex items-center justify-center hover:bg-gold-100 rounded-lg text-gold-700 transition-colors"
                                  onClick={() => setSelectedExpense(e)}
                                  aria-label="View Details"
                                  title="View Details"
                                >
                                  <Eye className="w-4 h-4 text-gold-700" />
                                </button>
                                <button
                                  type="button"
                                  className="w-9 h-9 flex items-center justify-center hover:bg-gold-100 rounded-lg text-gold-700 transition-colors"
                                  onClick={() => setDlg({ open: true, edit: e })}
                                  aria-label="Edit"
                                  title="Edit"
                                >
                                  <Pencil className="w-4 h-4 text-gold-600" />
                                </button>
                                <button
                                  type="button"
                                  className="w-9 h-9 flex items-center justify-center hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                                  onClick={() => setDeleteId(e.id)}
                                  aria-label="Delete"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4 text-red-500" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full min-w-[700px] text-sm border-collapse">
                          <thead className="bg-gold-50/70 text-gold-900 border-b border-gold-100">
                            <tr className="text-[10px] uppercase tracking-wider font-semibold">
                              <th className="text-left px-4 py-3 w-[120px] whitespace-nowrap">Date</th>
                              <th className="text-left px-4 py-3 w-[140px] whitespace-nowrap">Expense ID</th>
                              <th className="text-left px-4 py-3 min-w-[140px]">Title</th>
                              <th className="text-center px-4 py-3 whitespace-nowrap w-[140px]">Category</th>
                              <th className="text-right px-4 py-3 whitespace-nowrap min-w-[110px]">Amount</th>
                              <th className="text-left px-4 py-3 min-w-[140px]">Description</th>
                              <th className="text-right px-4 py-3 w-[120px] whitespace-nowrap">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gold-50">
                            {group.items.map((e) => {
                              const expCode = e.expense_code
                                ? `#${e.expense_code}`
                                : `#${e.id.slice(0, 8)}`;
                              return (
                                <tr key={e.id} className="hover:bg-gold-50/40 transition-colors">
                                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground font-medium align-middle w-[120px]">
                                    {fmtDate(e.expense_date)}
                                  </td>
                                  <td className="px-4 py-3.5 whitespace-nowrap align-middle w-[140px]">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedExpense(e)}
                                      className="font-mono text-gold-700 hover:text-gold-900 hover:underline font-bold text-xs inline-flex items-center gap-1 cursor-pointer bg-gold-50/60 border border-gold-200/80 px-2 py-0.5 rounded"
                                      title="View Expense Details"
                                    >
                                      {expCode}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3.5 align-middle min-w-[140px]">
                                    <button
                                      type="button"
                                      onClick={() => setSelectedExpense(e)}
                                      className="text-left font-semibold text-gold-950 text-xs hover:text-gold-700 hover:underline cursor-pointer block"
                                      title={e.title}
                                    >
                                      {e.title}
                                    </button>
                                  </td>
                                  <td className="px-4 py-3.5 text-center whitespace-nowrap align-middle w-[140px]">
                                    <div className="flex justify-center">
                                      <ExpenseCategoryBadge category={e.category} />
                                    </div>
                                  </td>
                                  <td className="text-right font-bold whitespace-nowrap px-4 py-3.5 text-emerald-600 text-xs align-middle min-w-[110px]">
                                    {fmtAED(e.amount).replace(" ", "\u00A0")}
                                  </td>
                                  <td
                                    className="px-4 py-3.5 text-xs text-muted-foreground max-w-xs truncate align-middle"
                                    title={e.description || undefined}
                                  >
                                    {e.description || "—"}
                                  </td>
                                  <td className="px-4 py-3.5 text-right whitespace-nowrap align-middle w-[120px]">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        className="w-9 h-9 flex items-center justify-center hover:bg-gold-100 rounded-lg text-gold-700 transition-colors"
                                        onClick={() => setSelectedExpense(e)}
                                        aria-label="View Details"
                                        title="View Details"
                                      >
                                        <Eye className="w-4 h-4 text-gold-700" />
                                      </button>
                                      <button
                                        type="button"
                                        className="w-9 h-9 flex items-center justify-center hover:bg-gold-100 rounded-lg text-gold-700 transition-colors"
                                        onClick={() => setDlg({ open: true, edit: e })}
                                        aria-label="Edit"
                                        title="Edit"
                                      >
                                        <Pencil className="w-4 h-4 text-gold-600" />
                                      </button>
                                      <button
                                        type="button"
                                        className="w-9 h-9 flex items-center justify-center hover:bg-red-50 rounded-lg text-red-600 transition-colors"
                                        onClick={() => setDeleteId(e.id)}
                                        aria-label="Delete"
                                        title="Delete"
                                      >
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            <div className="bg-white border border-gold-100 rounded-xl p-3">
              <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      <ExpenseDetailSheet
        open={!!selectedExpense}
        onOpenChange={(v) => {
          if (!v) setSelectedExpense(null);
        }}
        expense={selectedExpense}
        onEdit={(e) => {
          setSelectedExpense(null);
          setDlg({ open: true, edit: e });
        }}
        onDelete={(id) => {
          setSelectedExpense(null);
          setDeleteId(id);
        }}
      />

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


