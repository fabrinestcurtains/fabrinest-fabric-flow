import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  isValid,
  parseISO,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  ShoppingCart,
  CreditCard,
  Receipt,
  RefreshCw,
  Edit3,
  Trash2,
  Search,
  FileSpreadsheet,
  FileDown,
  Loader2,
  ChevronDown,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  UserCheck,
  RotateCcw,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase, type ActivityLog, type Expense } from "@/lib/supabase";
import { getDubaiNow } from "@/lib/format";
import { OrderStatusBadge, type OrderStatus } from "@/components/status-badges";
import { OrderDetailSheet } from "@/components/order-detail-sheet";
import { ExpenseDetailSheet } from "@/components/expense-detail-sheet";
import { CustomerDetail } from "@/routes/_authenticated/customers";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { DatePickerField } from "@/components/date-picker-field";
import { ChartErrorBoundary } from "@/components/chart-error-boundary";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/logs")({
  ssr: false,
  component: LogsPage,
});

const PAGE_SIZE = 20;
const MAX_PAGES = 99;

type DateFilterMode = "all" | "today" | "yesterday" | "week" | "month" | "year" | "custom";

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
  order_created: {
    icon: ShoppingCart,
    iconBg: "bg-amber-50 border-amber-200",
    iconColor: "text-amber-600",
    badge: "New order",
    badgeBg: "bg-amber-50",
    badgeColor: "text-amber-800",
  },
  order_edited: {
    icon: Edit3,
    iconBg: "bg-blue-50 border-blue-200",
    iconColor: "text-blue-600",
    badge: "Edit",
    badgeBg: "bg-blue-50",
    badgeColor: "text-blue-800",
  },
  order_deleted: {
    icon: Trash2,
    iconBg: "bg-orange-50 border-orange-200",
    iconColor: "text-orange-600",
    badge: "Delete",
    badgeBg: "bg-orange-50",
    badgeColor: "text-orange-800",
  },
  payment_added: {
    icon: CreditCard,
    iconBg: "bg-emerald-50 border-emerald-200",
    iconColor: "text-emerald-600",
    badge: "Payment",
    badgeBg: "bg-emerald-50",
    badgeColor: "text-emerald-800",
  },
  payment_deleted: {
    icon: Trash2,
    iconBg: "bg-orange-50 border-orange-200",
    iconColor: "text-orange-600",
    badge: "Delete",
    badgeBg: "bg-orange-50",
    badgeColor: "text-orange-800",
  },
  expense_created: {
    icon: Receipt,
    iconBg: "bg-rose-50 border-rose-200",
    iconColor: "text-rose-600",
    badge: "Expense",
    badgeBg: "bg-rose-50",
    badgeColor: "text-rose-800",
  },
  expense_edited: {
    icon: Edit3,
    iconBg: "bg-blue-50 border-blue-200",
    iconColor: "text-blue-600",
    badge: "Edit",
    badgeBg: "bg-blue-50",
    badgeColor: "text-blue-800",
  },
  expense_deleted: {
    icon: Trash2,
    iconBg: "bg-orange-50 border-orange-200",
    iconColor: "text-orange-600",
    badge: "Delete",
    badgeBg: "bg-orange-50",
    badgeColor: "text-orange-800",
  },
  status_changed: {
    icon: RefreshCw,
    iconBg: "bg-purple-50 border-purple-200",
    iconColor: "text-purple-600",
    badge: "Status change",
    badgeBg: "bg-purple-50",
    badgeColor: "text-purple-800",
  },
  customer_created: {
    icon: UserCheck,
    iconBg: "bg-teal-50 border-teal-200",
    iconColor: "text-teal-600",
    badge: "Customer",
    badgeBg: "bg-teal-50",
    badgeColor: "text-teal-800",
  },
  customer_edited: {
    icon: Edit3,
    iconBg: "bg-blue-50 border-blue-200",
    iconColor: "text-blue-600",
    badge: "Customer",
    badgeBg: "bg-blue-50",
    badgeColor: "text-blue-800",
  },
};

const FALLBACK_CONFIG = TYPE_CONFIG["order_edited"]!;

const ORDER_STATUS_LIST: OrderStatus[] = [
  "New Order",
  "Measurement Complete",
  "In Process",
  "Ready for Delivery",
  "Delivered",
  "Installed",
  "Completed",
  "Cancelled",
];

function fmtLogTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const time = formatInTimeZone(d, "Asia/Dubai", "hh:mm a");
  const dDateStr = formatInTimeZone(d, "Asia/Dubai", "yyyy-MM-dd");
  const nowDate = getDubaiNow();
  const nowDateStr = formatInTimeZone(nowDate, "Asia/Dubai", "yyyy-MM-dd");

  const dDay = new Date(dDateStr).getTime();
  const nowDay = new Date(nowDateStr).getTime();
  const diffDays = Math.round((nowDay - dDay) / 86400000);

  if (diffDays === 0) return `Today, ${time} (Dubai)`;
  if (diffDays === 1) return `Yesterday, ${time} (Dubai)`;
  return `${formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy, hh:mm a")} (Dubai)`;
}

function formatDateGroupHeader(dateStr: string, count: number): string {
  try {
    const d = parseISO(dateStr);
    if (!isValid(d)) return `${dateStr} — ${count} ${count === 1 ? "activity" : "activities"}`;
    const dNow = getDubaiNow();
    const todayStr = format(dNow, "yyyy-MM-dd");
    const yesterdayStr = format(subDays(dNow, 1), "yyyy-MM-dd");
    const formattedDate = formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy");
    const countText = `${count} ${count === 1 ? "activity" : "activities"}`;

    if (dateStr === todayStr) {
      return `Today — ${formattedDate} — ${countText}`;
    }
    if (dateStr === yesterdayStr) {
      return `Yesterday — ${formattedDate} — ${countText}`;
    }
    return `${formattedDate} — ${countText}`;
  } catch {
    return `${dateStr} — ${count} activities`;
  }
}

function extractPaymentAmount(log: ActivityLog): { text: string; isPositive: boolean } | null {
  const text = `${log.title} ${log.description ?? ""}`;
  const isRefund = log.activity_type.includes("refund") || /refund/i.test(text);

  const refundMatch = text.match(/[-−]\s*(?:AED\s*)?([\d,]+(?:\.\d+)?)/i);
  if (refundMatch || isRefund) {
    const num = refundMatch ? refundMatch[1] : text.match(/AED\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    if (num) return { text: `-AED ${num}`, isPositive: false };
  }

  const match = text.match(/(?:\+AED|\bAED|\+)\s*([\d,]+(?:\.\d+)?)/i);
  if (match) {
    return { text: `+AED ${match[1]}`, isPositive: true };
  }
  return null;
}

function extractNewStatus(log: ActivityLog): OrderStatus | null {
  if (log.activity_type !== "status_changed") return null;
  const text = `${log.description || ""} ${log.title}`;
  if (text.includes("→")) {
    const afterArrow = text.split("→").pop()?.trim();
    const found = ORDER_STATUS_LIST.find((s) => s.toLowerCase() === afterArrow?.toLowerCase());
    if (found) return found;
  }
  const foundAny = ORDER_STATUS_LIST.find((s) => text.toLowerCase().includes(s.toLowerCase()));
  return foundAny ?? null;
}

function extractExpenseCategory(log: ActivityLog): string | null {
  if (!log.activity_type.includes("expense")) return null;
  const catMatch =
    log.description?.match(/Category:\s*([^,\n·]+)/i) ??
    log.title.match(/\(([^)]+)\)$/) ??
    log.description?.match(/·\s*([^·]+)\s*·/);
  if (catMatch && catMatch[1]) {
    return catMatch[1].trim();
  }
  return null;
}

export function LogsPage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilterMode>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  // Dubai date intervals
  const dubaiDates = useMemo(() => {
    const dNow = getDubaiNow();
    const todayStr = format(dNow, "yyyy-MM-dd");
    const yesterdayStr = format(subDays(dNow, 1), "yyyy-MM-dd");
    const weekStartStr = format(startOfWeek(dNow, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const weekEndStr = format(endOfWeek(dNow, { weekStartsOn: 1 }), "yyyy-MM-dd");
    const monthStartStr = format(startOfMonth(dNow), "yyyy-MM-dd");
    const monthEndStr = format(endOfMonth(dNow), "yyyy-MM-dd");
    const yearStartStr = format(startOfYear(dNow), "yyyy-MM-dd");
    const yearEndStr = format(endOfYear(dNow), "yyyy-MM-dd");
    return {
      todayStr,
      yesterdayStr,
      weekStartStr,
      weekEndStr,
      monthStartStr,
      monthEndStr,
      yearStartStr,
      yearEndStr,
    };
  }, []);

  // Fetch all logs
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

  // Lookup map for resolving missing reference_ids on older expense logs
  const expensesLookupQ = useQuery({
    queryKey: ["expenses-lookup-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("expenses")
        .select("id, expense_code, amount, category, expense_date, title, created_at");
      return (data ?? []) as Expense[];
    },
    staleTime: 60_000,
  });

  const getExpenseRef = (log: ActivityLog): string | null => {
    // 1. If reference_id is already a valid code, and not the literal string "expense"
    if (log.reference_id) {
      const clean = log.reference_id.replace(/^#/, "").trim();
      if (clean && clean.toLowerCase() !== "expense") {
        return clean;
      }
    }

    // 2. Extract code (EXP...) from title or description
    const text = `${log.description || ""} ${log.title || ""}`;
    const codeMatch =
      text.match(/\b(EXP[A-Za-z0-9]+)\b/i) ||
      text.match(/Code:\s*([A-Za-z0-9_-]+)/i) ||
      text.match(/#(EXP[A-Za-z0-9]+)/i);
    if (codeMatch && codeMatch[1].toLowerCase() !== "expense") {
      return codeMatch[1].trim();
    }

    // 3. Fallback: match against expenses list by amount, category, and date
    const list = expensesLookupQ.data ?? [];
    if (list.length > 0) {
      const amtMatch = text.match(/(?:AED|\+AED)\s*([\d,]+(?:\.\d+)?)/i);
      const amt = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : null;
      const cat = extractExpenseCategory(log);

      if (amt != null || cat) {
        const matches = list.filter((e) => {
          const matchAmt = amt != null ? Math.abs(Number(e.amount) - amt) < 0.01 : true;
          const matchCat = cat
            ? e.category.toLowerCase().includes(cat.toLowerCase()) ||
              cat.toLowerCase().includes(e.category.toLowerCase())
            : true;
          return matchAmt && matchCat;
        });

        if (matches.length > 0) {
          try {
            const logDateStr = formatInTimeZone(new Date(log.created_at), "Asia/Dubai", "yyyy-MM-dd");
            const sameDate = matches.find((e) => e.expense_date === logDateStr);
            if (sameDate && (sameDate.expense_code || sameDate.id)) {
              return (sameDate.expense_code || sameDate.id).replace(/^#/, "").trim();
            }
          } catch {}
          return (matches[0].expense_code || matches[0].id).replace(/^#/, "").trim();
        }
      }
    }
    return null;
  };

  // Reset page on filter changes
  useEffect(() => {
    setPage(1);
  }, [activeFilter, dateFilter, customStart, customEnd, debouncedSearch]);

  // Filtered logs
  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim().replace(/^#+/, "");
    return allLogs.filter((l) => {
      // Type filter
      const matchType =
        activeFilter === "all"
          ? true
          : activeFilter === "order_deleted"
            ? l.activity_type.includes("deleted")
            : activeFilter === "order_edited"
              ? l.activity_type.includes("edited")
              : l.activity_type === activeFilter;

      // Search filter
      const isExp = l.activity_type.includes("expense");
      const expRef = isExp ? getExpenseRef(l) : null;
      const cleanRef = (l.reference_id ?? "").toLowerCase() === "expense" ? "" : (l.reference_id ?? "");
      const cleanRefStripped = cleanRef.replace(/^#+/, "").toLowerCase();
      const expRefStripped = (expRef ?? "").replace(/^#+/, "").toLowerCase();
      const matchSearch =
        !q ||
        l.title.toLowerCase().includes(q) ||
        cleanRefStripped.includes(q) ||
        expRefStripped.includes(q) ||
        (l.description ?? "").toLowerCase().includes(q);

      if (!matchType || !matchSearch) return false;

      // Date filter
      if (dateFilter === "all") return true;

      const d = new Date(l.created_at);
      if (!isValid(d)) return false;
      const logDubaiDate = formatInTimeZone(d, "Asia/Dubai", "yyyy-MM-dd");

      if (dateFilter === "today") {
        return logDubaiDate === dubaiDates.todayStr;
      }
      if (dateFilter === "yesterday") {
        return logDubaiDate === dubaiDates.yesterdayStr;
      }
      if (dateFilter === "week") {
        return logDubaiDate >= dubaiDates.weekStartStr && logDubaiDate <= dubaiDates.weekEndStr;
      }
      if (dateFilter === "month") {
        return logDubaiDate >= dubaiDates.monthStartStr && logDubaiDate <= dubaiDates.monthEndStr;
      }
      if (dateFilter === "year") {
        return logDubaiDate >= dubaiDates.yearStartStr && logDubaiDate <= dubaiDates.yearEndStr;
      }
      if (dateFilter === "custom") {
        if (customStart && logDubaiDate < customStart) return false;
        if (customEnd && logDubaiDate > customEnd) return false;
        return true;
      }

      return true;
    });
  }, [allLogs, activeFilter, debouncedSearch, dateFilter, customStart, customEnd, dubaiDates]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Group current page items by Dubai date
  const groupedByDate = useMemo(() => {
    const map = new Map<string, ActivityLog[]>();
    for (const log of pageItems) {
      const d = new Date(log.created_at);
      const dateKey = isValid(d) ? formatInTimeZone(d, "Asia/Dubai", "yyyy-MM-dd") : "Unknown";
      if (!map.has(dateKey)) {
        map.set(dateKey, []);
      }
      map.get(dateKey)!.push(log);
    }
    return Array.from(map.entries()).map(([date, items]) => ({
      date,
      items,
    }));
  }, [pageItems]);

  const toggleCollapseDate = (dateStr: string) => {
    setCollapsedDates((prev) => ({
      ...prev,
      [dateStr]: !prev[dateStr],
    }));
  };

  const handleRowClick = (log: ActivityLog) => {
    if (log.activity_type.includes("order") || log.activity_type.includes("payment")) {
      if (log.reference_id && log.reference_id.toLowerCase() !== "expense") {
        setSelectedOrderId(log.reference_id);
      }
    } else if (log.activity_type.includes("customer")) {
      if (log.reference_id && log.reference_id.toLowerCase() !== "expense") {
        setSelectedCustomerId(log.reference_id);
      }
    } else if (log.activity_type.includes("expense")) {
      const expRef = getExpenseRef(log);
      if (expRef && expRef.toLowerCase() !== "expense") {
        setSelectedExpenseId(expRef);
      }
    }
  };

  // Excel Export
  const handleExportExcel = async () => {
    setExporting("excel");
    try {
      if (filtered.length === 0) {
        toast.error("No activities to export for selected filters.");
        return;
      }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const reportDate = formatInTimeZone(new Date(), "Asia/Dubai", "dd MMM, yyyy 'at' hh:mm a");

      const rows: (string | number)[][] = [
        ["FABRINEST CURTAINS — ACTIVITY LOGS REPORT"],
        [`Generated: ${reportDate} (Asia/Dubai)`],
        [`Filter: Type=${activeFilter} | Date=${dateFilter} | Records=${filtered.length}`],
        [],
        [
          "Date (Dubai)",
          "Time (Dubai)",
          "Activity Type",
          "Title",
          "Reference ID",
          "Description",
        ],
        ...filtered.map((l) => {
          const d = new Date(l.created_at);
          const dateStr = isValid(d) ? formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy") : "—";
          const timeStr = isValid(d) ? `${formatInTimeZone(d, "Asia/Dubai", "hh:mm a")} (Dubai)` : "—";
          const typeLabel = TYPE_CONFIG[l.activity_type]?.badge ?? l.activity_type;
          const isExp = l.activity_type.includes("expense");
          const expRef = isExp ? getExpenseRef(l) : null;
          const refRaw = expRef || (l.reference_id && l.reference_id.toLowerCase() !== "expense" ? l.reference_id : null);
          const refDisplay = refRaw ? `#${refRaw.replace(/^#/, "")}` : "—";

          return [
            dateStr,
            timeStr,
            typeLabel,
            l.title,
            refDisplay,
            l.description ?? "—",
          ];
        }),
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 16 },
        { wch: 18 },
        { wch: 16 },
        { wch: 36 },
        { wch: 18 },
        { wch: 45 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Activity Logs");

      const filename = `Fabrinest-Activity-Logs-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Excel exported (${filtered.length} activities)!`);
    } catch (err: any) {
      console.error("Excel export error:", err);
      toast.error(err.message || "Failed to export Excel");
    } finally {
      setExporting(null);
    }
  };

  // PDF Export
  const handleExportPDF = async () => {
    setExporting("pdf");
    try {
      if (filtered.length === 0) {
        toast.error("No activities to export for selected filters.");
        return;
      }
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      let y = 18;

      // Header
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.setTextColor(120, 60, 10);
      pdf.text("FABRINEST CURTAINS", pageW / 2, y, { align: "center" });
      y += 6;

      pdf.setFontSize(11);
      pdf.setTextColor(80, 60, 30);
      pdf.text("Activity Logs Report", pageW / 2, y, { align: "center" });
      y += 5;

      const reportDate = formatInTimeZone(new Date(), "Asia/Dubai", "dd MMM, yyyy hh:mm a");
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        `Generated: ${reportDate} (Dubai) | Total: ${filtered.length} records | Filter: ${activeFilter}`,
        pageW / 2,
        y,
        { align: "center" }
      );
      y += 7;

      pdf.setDrawColor(193, 158, 101);
      pdf.setLineWidth(0.5);
      pdf.line(10, y, pageW - 10, y);
      y += 6;

      // Table Columns
      const colX = [12, 38, 70, 95, 138, 166];
      const headers = ["Date", "Time (Dubai)", "Type", "Title", "Ref ID", "Description"];

      const drawTableHeader = () => {
        pdf.setFillColor(243, 237, 226);
        pdf.rect(10, y - 4, pageW - 20, 7, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 70, 20);
        headers.forEach((h, i) => pdf.text(h, colX[i], y));
        y += 7;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
      };

      drawTableHeader();

      for (const log of filtered) {
        if (y > pageH - 18) {
          pdf.addPage();
          y = 15;
          drawTableHeader();
        }

        const d = new Date(log.created_at);
        const dateStr = isValid(d) ? formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy") : "—";
        const timeStr = isValid(d) ? `${formatInTimeZone(d, "Asia/Dubai", "hh:mm a")} (Dubai)` : "—";
        const typeLabel = TYPE_CONFIG[log.activity_type]?.badge ?? log.activity_type;
        const title = (log.title || "—").slice(0, 22);
        const isExp = log.activity_type.includes("expense");
        const expRef = isExp ? getExpenseRef(log) : null;
        const refRaw = expRef || (log.reference_id && log.reference_id.toLowerCase() !== "expense" ? log.reference_id : null);
        const refId = refRaw ? `#${refRaw.replace(/^#/, "").slice(0, 14)}` : "—";
        const desc = (log.description || "—").slice(0, 20);

        pdf.setTextColor(70);
        pdf.text(dateStr, colX[0], y);
        pdf.text(timeStr, colX[1], y);
        pdf.text(typeLabel, colX[2], y);
        pdf.text(title, colX[3], y);
        pdf.text(refId, colX[4], y);
        pdf.text(desc, colX[5], y);

        y += 5.5;
      }

      const filename = `Fabrinest-Activity-Logs-${format(new Date(), "yyyy-MM-dd")}.pdf`;
      pdf.save(filename);
      toast.success(`PDF exported (${filtered.length} activities)!`);
    } catch (err: any) {
      console.error("PDF export error:", err);
      toast.error(err.message || "Failed to export PDF");
    } finally {
      setExporting(null);
    }
  };

  const handleResetFilters = () => {
    setActiveFilter("all");
    setDateFilter("all");
    setCustomStart("");
    setCustomEnd("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="relative w-full">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search activity, order ID, details…"
          className="pl-9 pr-9 bg-white h-[42px] rounded-[12px] border-gold-100 text-sm focus-visible:ring-gold-400 shadow-2xs"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
          >
            Clear
          </button>
        )}
      </div>

      {/* Controls Card: Wrap filters in white card bg-white border gold-100 rounded 16px p-[14px] shadow */}
      <div className="bg-white border border-gold-100 rounded-[16px] p-[14px] sm:p-4 shadow-xs space-y-3.5">
        {/* Top row: results count left + Export buttons right (justify-end on desktop, justify-start on mobile) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-gold-100/70">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div>
              {logsQ.isLoading
                ? "Loading activities…"
                : `Showing ${pageItems.length} of ${filtered.length} activities${
                    activeFilter !== "all"
                      ? ` · ${ACTIVITY_TYPES.find((t) => t.value === activeFilter)?.label ?? activeFilter}`
                      : ""
                  }${dateFilter !== "all" ? ` · Date: ${dateFilter}` : ""}${
                    debouncedSearch ? ` · matching "${debouncedSearch}"` : ""
                  }`}
            </div>

            {(activeFilter !== "all" || dateFilter !== "all" || search) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-gold-600 hover:text-gold-800 underline inline-flex items-center gap-1 font-medium whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" /> Reset Filters
              </button>
            )}
          </div>

          <div className="flex items-center justify-start sm:justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportExcel}
              disabled={!!exporting || filtered.length === 0}
              className="bg-[#F6FBF7] hover:bg-[#EBF6EE] border-[#C8E6D0] text-[#1B5E20] font-medium transition-colors shadow-2xs h-8 text-xs"
            >
              {exporting === "excel" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Exporting...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> Export Excel
                </>
              )}
            </Button>

            <Button
              size="sm"
              onClick={handleExportPDF}
              disabled={!!exporting || filtered.length === 0}
              className="bg-[#8B5A2B] hover:bg-[#704822] text-white border-transparent font-medium transition-colors shadow-2xs h-8 text-xs"
            >
              {exporting === "pdf" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Exporting...
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5 mr-1.5" /> Export PDF
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Date Range label uppercase 11px + chips row */}
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Date Range
          </div>
          <div className="flex items-center gap-[6px] flex-nowrap overflow-x-auto pb-1 md:pb-0 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {(
              [
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "week", label: "This Week" },
                { id: "month", label: "This Month" },
                { id: "year", label: "This Year" },
                { id: "all", label: "All Time" },
                { id: "custom", label: "Custom" },
              ] as { id: DateFilterMode; label: string }[]
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => {
                  setDateFilter(btn.id);
                  setPage(1);
                }}
                className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all min-h-[32px] flex items-center justify-center whitespace-nowrap shrink-0 ${
                  dateFilter === btn.id
                    ? "bg-[#8B5A2B] text-white border-[#8B5A2B] shadow-xs"
                    : "bg-white text-muted-foreground border-gold-200/80 hover:bg-gold-50/60 hover:text-gold-900"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gold-50/40 border border-gold-100 flex-wrap">
            <CalendarIcon className="w-4 h-4 text-gold-700 shrink-0" />
            <span className="text-xs font-medium text-gold-900">Custom Date Range:</span>
            <div className="w-40">
              <DatePickerField
                value={customStart}
                onChange={(val) => {
                  setCustomStart(val);
                  setPage(1);
                }}
                placeholder="Start Date"
                className="h-8 text-xs bg-white"
              />
            </div>
            <span className="text-xs text-muted-foreground">to</span>
            <div className="w-40">
              <DatePickerField
                value={customEnd}
                onChange={(val) => {
                  setCustomEnd(val);
                  setPage(1);
                }}
                placeholder="End Date"
                className="h-8 text-xs bg-white"
              />
            </div>
            {(customStart || customEnd) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCustomStart("");
                  setCustomEnd("");
                  setPage(1);
                }}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </Button>
            )}
          </div>
        )}

        {/* Type label + chips: All New order Payment Expense Status change Edit Delete - active bg #3D2314 */}
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            Type
          </div>
          <div className="flex items-center gap-[6px] flex-nowrap overflow-x-auto pb-1 md:pb-0 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {ACTIVITY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setActiveFilter(t.value);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs border transition-all whitespace-nowrap min-h-[30px] flex items-center shrink-0 ${
                  activeFilter === t.value
                    ? "bg-[#3D2314] border-[#3D2314] text-white font-medium shadow-xs"
                    : "border-gold-200/80 text-muted-foreground hover:border-gold-400 hover:text-gold-700 bg-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grouped Logs Table / Timeline */}
      <ChartErrorBoundary>
        <div className="space-y-4">
          {logsQ.isLoading ? (
            <div className="bg-white border border-gold-100 rounded-xl p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto animate-spin text-gold-500 mb-2" />
              Loading activities…
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-gold-100 rounded-xl p-8">
              <EmptyState
                icon={<Activity className="w-10 h-10 text-gold-400" />}
                title={allLogs.length === 0 ? "No activities recorded yet" : "No activities found for selected filters"}
                description="Try clearing your search keyword, changing the date range, or picking another activity type."
                action={
                  (activeFilter !== "all" || dateFilter !== "all" || search) && (
                    <Button variant="outline" size="sm" onClick={handleResetFilters}>
                      Reset All Filters
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            groupedByDate.map((group) => {
              const isCollapsed = !!collapsedDates[group.date];

              return (
                <div
                  key={group.date}
                  className="bg-white border border-gold-100 rounded-xl overflow-hidden shadow-xs"
                >
                  {/* Collapsible Date Header */}
                  <button
                    type="button"
                    onClick={() => toggleCollapseDate(group.date)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gold-50/70 border-b border-gold-100 hover:bg-gold-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gold-700 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gold-700 shrink-0" />
                      )}
                      <span className="font-semibold text-gold-900 text-sm">
                        {formatDateGroupHeader(group.date, group.items.length)}
                      </span>
                    </div>

                    <div className="text-right text-xs text-muted-foreground">
                      {group.items.length} {group.items.length === 1 ? "entry" : "entries"}
                    </div>
                  </button>

                  {/* Expanded Timeline Content */}
                  {!isCollapsed && (
                    <div className="p-4 space-y-3 relative before:absolute before:left-[29px] before:top-4 before:bottom-4 before:w-0.5 before:bg-gold-200">
                      {group.items.map((log) => {
                        const cfg = TYPE_CONFIG[log.activity_type] ?? FALLBACK_CONFIG;
                        const Icon = cfg.icon;
                        const isOrderOrPayment =
                          log.activity_type.includes("order") || log.activity_type.includes("payment");
                        const isCustomer = log.activity_type.includes("customer");
                        const isExpense = log.activity_type.includes("expense");
                        const expenseRefId = isExpense ? getExpenseRef(log) : null;
                        const isClickable = Boolean(
                          (log.reference_id &&
                            (isOrderOrPayment || isCustomer) &&
                            log.reference_id.toLowerCase() !== "expense") ||
                          (isExpense && expenseRefId && expenseRefId.toLowerCase() !== "expense")
                        );
                        const amountBadge = extractPaymentAmount(log);
                        const statusBadge = extractNewStatus(log);
                        const expenseCategory = extractExpenseCategory(log);

                        return (
                          <div
                            key={log.id}
                            onClick={() => handleRowClick(log)}
                            className={`relative flex items-start gap-3 pl-11 pr-3 py-3 rounded-lg border border-gold-100 bg-white transition-colors shadow-2xs ${
                              isClickable
                                ? "cursor-pointer hover:bg-gold-50/60 hover:border-gold-300"
                                : ""
                            }`}
                          >
                            {/* Node icon placed precisely on vertical timeline line */}
                            <div
                              className={`absolute left-[17px] -translate-x-1/2 top-3 w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-xs z-10 ${cfg.iconBg}`}
                            >
                              <Icon className={`w-3.5 h-3.5 ${cfg.iconColor}`} />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-gold-950">
                                  {log.title}
                                </span>

                                {/* Reference ID button/badge */}
                                {isOrderOrPayment && log.reference_id && log.reference_id.toLowerCase() !== "expense" ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedOrderId(log.reference_id!);
                                    }}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-gold-50 border border-gold-200 text-gold-700 font-semibold hover:bg-gold-100 hover:underline transition-colors"
                                    title="Open Order Details"
                                  >
                                    #{log.reference_id.replace(/^#/, "")}
                                  </button>
                                ) : isCustomer && log.reference_id && log.reference_id.toLowerCase() !== "expense" ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedCustomerId(log.reference_id!);
                                    }}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-semibold hover:bg-blue-100 hover:underline transition-colors"
                                    title="Open Customer Details"
                                  >
                                    #{log.reference_id.replace(/^#/, "")}
                                  </button>
                                ) : isExpense && expenseRefId && expenseRefId.toLowerCase() !== "expense" ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedExpenseId(expenseRefId);
                                    }}
                                    className="font-mono text-xs px-2 py-0.5 rounded bg-gold-50 border border-gold-200 text-gold-700 font-semibold hover:bg-gold-100 hover:underline transition-colors cursor-pointer"
                                    title="Open Expense Details"
                                  >
                                    #{expenseRefId.replace(/^#/, "")}
                                  </button>
                                ) : log.reference_id && log.reference_id.toLowerCase() !== "expense" ? (
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-gold-50 border border-gold-100 text-gold-700">
                                    #{log.reference_id.replace(/^#/, "")}
                                  </span>
                                ) : null}

                                {/* Amount badge for payment logs */}
                                {amountBadge && (
                                  <span
                                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                      amountBadge.isPositive
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                        : "bg-red-50 text-red-700 border border-red-200"
                                    }`}
                                  >
                                    {amountBadge.text}
                                  </span>
                                )}

                                {/* Status badge for status_changed */}
                                {statusBadge && <OrderStatusBadge status={statusBadge} />}

                                {/* Category badge for expense logs */}
                                {expenseCategory && (
                                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                                    {expenseCategory}
                                  </span>
                                )}
                              </div>

                              {log.description && (
                                <p className="text-xs text-muted-foreground mt-1 break-words">
                                  {log.description}
                                </p>
                              )}

                              <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                                <Clock className="w-3 h-3 text-gold-500 shrink-0" />
                                <span>{fmtLogTime(log.created_at)}</span>
                              </div>
                            </div>

                            <span
                              className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full font-medium ${cfg.badgeBg} ${cfg.badgeColor}`}
                            >
                              {cfg.badge}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ChartErrorBoundary>

      {/* Pagination */}
      <Pagination
        page={safePage}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onChange={setPage}
      />

      {/* Order Detail Sheet */}
      <OrderDetailSheet
        orderId={selectedOrderId}
        open={!!selectedOrderId}
        onOpenChange={(v) => {
          if (!v) setSelectedOrderId(null);
        }}
      />

      {/* Customer Detail Sheet */}
      <CustomerDetail
        customerId={selectedCustomerId}
        open={!!selectedCustomerId}
        onOpenChange={(v) => {
          if (!v) setSelectedCustomerId(null);
        }}
      />

      {/* Expense Detail Sheet */}
      <ExpenseDetailSheet
        expenseId={selectedExpenseId}
        open={!!selectedExpenseId}
        onOpenChange={(v) => {
          if (!v) setSelectedExpenseId(null);
        }}
      />
    </div>
  );
}
