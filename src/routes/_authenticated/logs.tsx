import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ShoppingCart,
  CreditCard,
  Receipt,
  RefreshCw,
  Edit3,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase, type ActivityLog } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/logs")({
  ssr: false,
  component: LogsPage,
});

const PAGE_SIZE = 20;
const MAX_PAGES = 99;

const ACTIVITY_TYPES = [
  { value: "all", label: "All" },
  { value: "order_created", label: "New order" },
  { value: "payment_added", label: "Payment" },
  { value: "expense_created", label: "Expense" },
  { value: "status_changed", label: "Status change" },
  { value: "order_edited", label: "Edit" },
  { value: "order_deleted", label: "Delete" },
] as const;

type TypeConfig = {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
};

const TYPE_CONFIG: Record<string, TypeConfig> = {
  order_created: { icon: ShoppingCart, iconBg: "bg-amber-50", iconColor: "text-amber-600", badge: "New order", badgeBg: "bg-amber-50", badgeColor: "text-amber-800" },
  order_edited: { icon: Edit3, iconBg: "bg-blue-50", iconColor: "text-blue-600", badge: "Edit", badgeBg: "bg-blue-50", badgeColor: "text-blue-800" },
  order_deleted: { icon: Trash2, iconBg: "bg-orange-50", iconColor: "text-orange-600", badge: "Delete", badgeBg: "bg-orange-50", badgeColor: "text-orange-800" },
  payment_added: { icon: CreditCard, iconBg: "bg-green-50", iconColor: "text-green-600", badge: "Payment", badgeBg: "bg-green-50", badgeColor: "text-green-800" },
  payment_deleted: { icon: Trash2, iconBg: "bg-orange-50", iconColor: "text-orange-600", badge: "Delete", badgeBg: "bg-orange-50", badgeColor: "text-orange-800" },
  expense_created: { icon: Receipt, iconBg: "bg-red-50", iconColor: "text-red-600", badge: "Expense", badgeBg: "bg-red-50", badgeColor: "text-red-800" },
  expense_edited: { icon: Edit3, iconBg: "bg-blue-50", iconColor: "text-blue-600", badge: "Edit", badgeBg: "bg-blue-50", badgeColor: "text-blue-800" },
  expense_deleted: { icon: Trash2, iconBg: "bg-orange-50", iconColor: "text-orange-600", badge: "Delete", badgeBg: "bg-orange-50", badgeColor: "text-orange-800" },
  status_changed: { icon: RefreshCw, iconBg: "bg-purple-50", iconColor: "text-purple-600", badge: "Status change", badgeBg: "bg-purple-50", badgeColor: "text-purple-800" },
};

const FALLBACK_CONFIG = TYPE_CONFIG["order_edited"]!;

function fmtLogTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return `Today, ${format(d, "hh:mm a")}`;
  if (diffDays === 1) return `Yesterday, ${format(d, "hh:mm a")}`;
  return format(d, "dd MMM, hh:mm a");
}

function buildPageNumbers(current: number, total: number): (number | "…")[] {
  const show = new Set<number>();
  show.add(1);
  if (total >= 2) show.add(2);
  show.add(total);
  if (total > 1) show.add(total - 1);
  show.add(current);
  if (current > 1) show.add(current - 1);
  if (current < total) show.add(current + 1);

  const sorted = [...show].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) result.push("…");
    result.push(sorted[i]!);
  }
  return result;
}

function LogsPage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [jumpVal, setJumpVal] = useState("");

  const logsQ = useQuery({
    queryKey: ["activity-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_PAGES * PAGE_SIZE);
      return (data ?? []) as ActivityLog[];
    },
  });

  const allLogs = logsQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allLogs.filter((l) => {
      const matchType = activeFilter === "all" || l.activity_type === activeFilter;
      const matchSearch =
        !q ||
        l.title.toLowerCase().includes(q) ||
        (l.reference_id ?? "").toLowerCase().includes(q) ||
        (l.description ?? "").toLowerCase().includes(q);
      return matchType && matchSearch;
    });
  }, [allLogs, activeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const goPage = (p: number) => {
    if (p < 1 || p > totalPages) return;
    setPage(p);
  };

  const handleFilterChange = (val: string) => {
    setActiveFilter(val);
    setPage(1);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(1);
  };

  const handleJump = () => {
    const n = parseInt(jumpVal, 10);
    if (!isNaN(n)) goPage(n);
    setJumpVal("");
  };

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gold-900">Activity Log</h2>
          <p className="text-xs text-muted-foreground">All business activities — sorted by most recent</p>
        </div>
        <div className="relative sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search activity, order ID, details…"
            className="pl-9 bg-white"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filter:</span>
        {ACTIVITY_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => handleFilterChange(t.value)}
            className={`px-3 py-1 rounded-full text-xs border transition-all ${
              activeFilter === t.value
                ? "bg-gold-500 border-gold-500 text-white"
                : "border-gold-200 text-muted-foreground hover:border-gold-400 hover:text-gold-700 bg-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        {logsQ.isLoading
          ? "Loading…"
          : filtered.length === allLogs.length
            ? `Showing all ${allLogs.length} activities`
            : `${filtered.length} result${filtered.length !== 1 ? "s" : ""} found`}
      </div>

      {/* Log list */}
      <div className="rounded-lg border border-gold-100 bg-white divide-y divide-gold-100 overflow-hidden">
        {logsQ.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground text-center">Loading activities…</p>
        ) : pageItems.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">No activities found.</p>
        ) : (
          pageItems.map((log) => {
            const cfg = TYPE_CONFIG[log.activity_type] ?? FALLBACK_CONFIG;
            const Icon = cfg.icon;
            return (
              <div key={log.id} className="flex items-start gap-3 p-3 hover:bg-gold-50/60 transition-colors">
                <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${cfg.iconBg}`}>
                  <Icon className={`w-4 h-4 ${cfg.iconColor}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gold-900">{log.title}</span>
                    {log.reference_id && (
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gold-50 border border-gold-100 text-gold-700">
                        {log.reference_id}
                      </span>
                    )}
                  </div>
                  {log.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{log.description}</p>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-1">{fmtLogTime(log.created_at)}</div>
                </div>
                <span
                  className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${cfg.badgeBg} ${cfg.badgeColor}`}
                >
                  {cfg.badge}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} ·
            Page {safePage} of {totalPages}
          </span>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goPage(safePage - 1)}
              disabled={safePage === 1}
              className="h-7 px-2"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            {buildPageNumbers(safePage, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => goPage(p)}
                  className={`w-7 h-7 text-xs rounded-md border transition-all ${
                    p === safePage
                      ? "bg-gold-500 border-gold-500 text-white font-medium"
                      : "border-gold-200 text-muted-foreground hover:border-gold-400 hover:text-gold-700 bg-white"
                  }`}
                >
                  {p}
                </button>
              ),
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => goPage(safePage + 1)}
              disabled={safePage === totalPages}
              className="h-7 px-2"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Go to page</span>
            <input
              value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJump()}
              className="w-9 h-6 text-center text-xs border border-gold-200 rounded-md outline-none focus:border-gold-400 bg-white text-gold-900"
            />
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={handleJump}>
              Go
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
