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
  Wallet,
  Search,
  Inbox,
  FileSpreadsheet,
  FileDown,
  Loader2,
  ChevronDown,
  ChevronRight,
  Calendar as CalendarIcon,
  X,
  TrendingUp,
  Clock,
  CalendarDays,
  CheckCircle2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  supabase,
  ACTIVE_ORDERS_FILTER,
  sanitizeSearch,
} from "@/lib/supabase";
import {
  fmtAED,
  fmtDate,
  getDubaiNow,
} from "@/lib/format";
import { OrderDetailSheet } from "@/components/order-detail-sheet";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { DatePickerField } from "@/components/date-picker-field";
import { ChartErrorBoundary } from "@/components/chart-error-boundary";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/collections")({
  ssr: false,
  component: CollectionsPage,
});

type DateFilterMode = "today" | "yesterday" | "week" | "month" | "all" | "custom";

const PAGE_SIZE = 20;

function formatDubaiTime(createdAt?: string | null): string {
  if (!createdAt) return "—";
  try {
    const d = new Date(createdAt);
    if (!isValid(d)) return "—";
    return formatInTimeZone(d, "Asia/Dubai", "hh:mm a");
  } catch {
    return "—";
  }
}

function formatDateHeader(dateStr: string): string {
  try {
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim());
    const d = isDateOnly ? parseISO(dateStr.trim()) : new Date(dateStr);
    if (!isValid(d)) return dateStr;
    const formattedDate = formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy");

    const dubaiNow = getDubaiNow();
    const todayStr = format(dubaiNow, "yyyy-MM-dd");
    const yesterdayStr = format(subDays(dubaiNow, 1), "yyyy-MM-dd");
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

async function findMatchingOrderIds(s: string): Promise<string[] | null> {
  if (!s) return null;
  const { data: matchingCustomers } = await supabase
    .from("customers")
    .select("id")
    .or(`name.ilike.%${s}%,mobile.ilike.%${s}%`)
    .limit(50);
  const customerIds = matchingCustomers?.map((c) => c.id) || [];

  let orderQuery = supabase
    .from("orders")
    .select("id")
    .or(ACTIVE_ORDERS_FILTER);

  if (customerIds.length > 0) {
    orderQuery = orderQuery.or(`id.ilike.%${s}%,customer_id.in.(${customerIds.join(",")})`);
  } else {
    orderQuery = orderQuery.ilike("id", `%${s}%`);
  }

  const { data: matchingOrders } = await orderQuery.limit(100);
  return matchingOrders?.map((o) => o.id) || [];
}

export function CollectionsPage() {
  const [dateFilter, setDateFilter] = useState<DateFilterMode>("all");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [dateFilter, customStart, customEnd, debouncedSearch]);

  // Dubai date calculations
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

  // Top Summary Cards Query (4 cards grid: Today, This Week, This Month, This Year)
  const summaryQuery = useQuery({
    queryKey: ["collections-summary", dubaiDates.todayStr],
    queryFn: async () => {
      const [todayQ, weekQ, monthQ, yearQ] = await Promise.all([
        supabase
          .from("payments")
          .select("amount, orders!inner(is_deleted)")
          .eq("payment_type", "payment")
          .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
          .eq("payment_date", dubaiDates.todayStr),
        supabase
          .from("payments")
          .select("amount, orders!inner(is_deleted)")
          .eq("payment_type", "payment")
          .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
          .gte("payment_date", dubaiDates.weekStartStr)
          .lte("payment_date", dubaiDates.weekEndStr),
        supabase
          .from("payments")
          .select("amount, orders!inner(is_deleted)")
          .eq("payment_type", "payment")
          .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
          .gte("payment_date", dubaiDates.monthStartStr)
          .lte("payment_date", dubaiDates.monthEndStr),
        supabase
          .from("payments")
          .select("amount, orders!inner(is_deleted)")
          .eq("payment_type", "payment")
          .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
          .gte("payment_date", dubaiDates.yearStartStr)
          .lte("payment_date", dubaiDates.yearEndStr),
      ]);

      const sumAmount = (data: any[] | null) =>
        (data ?? []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0);

      return {
        today: {
          total: sumAmount(todayQ.data),
          count: todayQ.data?.length ?? 0,
        },
        week: {
          total: sumAmount(weekQ.data),
          count: weekQ.data?.length ?? 0,
        },
        month: {
          total: sumAmount(monthQ.data),
          count: monthQ.data?.length ?? 0,
        },
        year: {
          total: sumAmount(yearQ.data),
          count: yearQ.data?.length ?? 0,
        },
      };
    },
    staleTime: 30_000,
  });

  // Main collections query
  const collectionsQuery = useQuery({
    queryKey: [
      "collections-list",
      dateFilter,
      customStart,
      customEnd,
      debouncedSearch,
      page,
      dubaiDates.todayStr,
    ],
    queryFn: async () => {
      const s = sanitizeSearch(debouncedSearch);

      let q = supabase
        .from("payments")
        .select(
          "*, orders!inner(id, customer_id, is_deleted, customers(name, mobile))",
          { count: "exact" }
        )
        .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
        .eq("payment_type", "payment");

      // Date range filter
      if (dateFilter === "today") {
        q = q.eq("payment_date", dubaiDates.todayStr);
      } else if (dateFilter === "yesterday") {
        q = q.eq("payment_date", dubaiDates.yesterdayStr);
      } else if (dateFilter === "week") {
        q = q
          .gte("payment_date", dubaiDates.weekStartStr)
          .lte("payment_date", dubaiDates.weekEndStr);
      } else if (dateFilter === "month") {
        q = q
          .gte("payment_date", dubaiDates.monthStartStr)
          .lte("payment_date", dubaiDates.monthEndStr);
      } else if (dateFilter === "custom") {
        if (customStart) q = q.gte("payment_date", customStart);
        if (customEnd) q = q.lte("payment_date", customEnd);
      }

      // Search filter: Order ID or Customer Name / Mobile
      if (s) {
        const orderIds = await findMatchingOrderIds(s);
        if (!orderIds || orderIds.length === 0) {
          return {
            rows: [],
            total: 0,
          };
        }
        q = q.in("order_id", orderIds);
      }

      q = q
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      const { data, count, error } = await q;
      if (error) throw error;

      return {
        rows: (data ?? []) as any[],
        total: count ?? 0,
      };
    },
  });

  const rawRows = collectionsQuery.data?.rows ?? [];
  const totalRecords = collectionsQuery.data?.total ?? 0;

  // Group payments by payment_date
  const groupedByDate = useMemo(() => {
    const groups: {
      date: string;
      totalAmount: number;
      items: any[];
    }[] = [];

    const map = new Map<string, { totalAmount: number; items: any[] }>();

    for (const item of rawRows) {
      const rawDate = item.payment_date;
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

    map.forEach((value, key) => {
      groups.push({
        date: key,
        totalAmount: value.totalAmount,
        items: value.items,
      });
    });

    return groups;
  }, [rawRows]);

  const toggleCollapseDate = (d: string) => {
    setCollapsedDates((prev) => ({ ...prev, [d]: !prev[d] }));
  };

  // Helper to fetch all payments matching active filters for Export
  const fetchAllForExport = async () => {
    const s = sanitizeSearch(debouncedSearch);
    let q = supabase
      .from("payments")
      .select(
        "*, orders!inner(id, customer_id, is_deleted, customers(name, mobile))"
      )
      .or(ACTIVE_ORDERS_FILTER, { foreignTable: "orders" })
      .eq("payment_type", "payment");

    if (dateFilter === "today") {
      q = q.eq("payment_date", dubaiDates.todayStr);
    } else if (dateFilter === "yesterday") {
      q = q.eq("payment_date", dubaiDates.yesterdayStr);
    } else if (dateFilter === "week") {
      q = q
        .gte("payment_date", dubaiDates.weekStartStr)
        .lte("payment_date", dubaiDates.weekEndStr);
    } else if (dateFilter === "month") {
      q = q
        .gte("payment_date", dubaiDates.monthStartStr)
        .lte("payment_date", dubaiDates.monthEndStr);
    } else if (dateFilter === "custom") {
      if (customStart) q = q.gte("payment_date", customStart);
      if (customEnd) q = q.lte("payment_date", customEnd);
    }

    if (s) {
      const orderIds = await findMatchingOrderIds(s);
      if (!orderIds || orderIds.length === 0) {
        return [];
      }
      q = q.in("order_id", orderIds);
    }

    q = q
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as any[];
  };

  // Excel Export
  const handleExportExcel = async () => {
    setExporting("excel");
    try {
      const items = await fetchAllForExport();
      if (items.length === 0) {
        toast.error("No collections to export for selected filters.");
        return;
      }

      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const totalSum = items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const reportDate = format(new Date(), "dd MMM yyyy 'at' hh:mm a");

      const rows: (string | number)[][] = [
        ["FABRINEST CURTAINS — COLLECTIONS REPORT"],
        [`Generated: ${reportDate} (Asia/Dubai)`],
        [`Filter: Date=${dateFilter} | Records=${items.length}`],
        [`Total Collections: AED ${totalSum.toLocaleString("en-US", { minimumFractionDigits: 2 })}`],
        [],
        [
          "Date (Dubai)",
          "Time (Dubai)",
          "Customer Name",
          "Customer Mobile",
          "Order ID",
          "Amount (AED)",
          "Note",
        ],
        ...items.map((p) => {
          const cust = p.orders?.customers;
          const dubaiTime = formatDubaiTime(p.created_at);
          return [
            fmtDate(p.payment_date),
            dubaiTime !== "—" ? `${dubaiTime} (Dubai)` : "—",
            cust?.name ?? "—",
            cust?.mobile ?? "—",
            `#${p.order_id || p.orders?.id || ""}`,
            Number(p.amount) || 0,
            p.note || "",
          ];
        }),
        [],
        ["TOTAL", "", "", "", "", totalSum, ""],
      ];

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [
        { wch: 16 },
        { wch: 18 },
        { wch: 24 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, ws, "Collections");

      const filename = `Fabrinest-Collections-${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Excel exported (${items.length} collections)!`);
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
      const items = await fetchAllForExport();
      if (items.length === 0) {
        toast.error("No collections to export for selected filters.");
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
      pdf.text("Collections Report", pageW / 2, y, { align: "center" });
      y += 5;

      const totalSum = items.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      pdf.setFontSize(8);
      pdf.setTextColor(120);
      pdf.text(
        `Generated: ${format(new Date(), "dd MMM yyyy hh:mm a")} (Dubai) | Total: AED ${totalSum.toLocaleString("en-US")} (${items.length} records)`,
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
      const colX = [12, 38, 72, 118, 148, 172];
      const headers = ["Date", "Time (Dubai)", "Customer", "Order ID", "Amount", "Note"];

      pdf.setFillColor(243, 237, 226);
      pdf.rect(10, y - 4, pageW - 20, 7, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 70, 20);
      headers.forEach((h, i) => pdf.text(h, colX[i], y));
      y += 7;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);

      for (const p of items) {
        if (y > pageH - 18) {
          pdf.addPage();
          y = 15;
          // Re-draw table header on new page
          pdf.setFillColor(243, 237, 226);
          pdf.rect(10, y - 4, pageW - 20, 7, "F");
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.setTextColor(100, 70, 20);
          headers.forEach((h, i) => pdf.text(h, colX[i], y));
          y += 7;
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7.5);
        }

        const custName = (p.orders?.customers?.name ?? "—").slice(0, 22);
        const orderId = `#${(p.order_id || p.orders?.id || "").slice(0, 12)}`;
        const note = (p.note || "—").slice(0, 16);
        const dubaiTime = formatDubaiTime(p.created_at);

        pdf.setTextColor(70);
        pdf.text(fmtDate(p.payment_date), colX[0], y);
        pdf.text(dubaiTime !== "—" ? `${dubaiTime} (Dubai)` : "—", colX[1], y);
        pdf.text(custName, colX[2], y);
        pdf.text(orderId, colX[3], y);

        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(22, 101, 52); // green-700
        pdf.text(`+${Number(p.amount).toLocaleString("en-US")}`, colX[4], y);

        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(100);
        pdf.text(note, colX[5], y);

        y += 5.5;
      }

      // Total row
      y += 2;
      pdf.setDrawColor(200);
      pdf.line(10, y, pageW - 10, y);
      y += 5;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(120, 60, 10);
      pdf.text("Total Collections:", colX[3], y);
      pdf.setTextColor(22, 101, 52);
      pdf.text(`AED ${totalSum.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[4], y);

      const filename = `Fabrinest-Collections-${format(new Date(), "yyyy-MM-dd")}.pdf`;
      pdf.save(filename);
      toast.success("PDF exported successfully!");
    } catch (err: any) {
      console.error("PDF export error:", err);
      toast.error(err.message || "Failed to export PDF");
    } finally {
      setExporting(null);
    }
  };

  const sumData = summaryQuery.data;

  return (
    <div className="space-y-6">
      {/* Top Export Actions */}
      <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={!!exporting}
            className="border-gold-200 text-gold-800 hover:bg-gold-50"
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
            disabled={!!exporting}
            className="gold-gradient text-white hover:opacity-95"
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

      {/* 4 Summary Cards Grid */}
      <ChartErrorBoundary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Today Collection */}
          <div className="bg-white border border-gold-100 rounded-xl p-3.5 md:p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Today Collection
              </span>
              <div className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Clock className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg md:text-2xl font-bold text-emerald-700 mt-1.5">
              {summaryQuery.isLoading ? "—" : fmtAED(sumData?.today.total ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {summaryQuery.isLoading
                ? "Calculating..."
                : `${sumData?.today.count ?? 0} payment${sumData?.today.count === 1 ? "" : "s"} today`}
            </div>
          </div>

          {/* This Week Collection */}
          <div className="bg-white border border-gold-100 rounded-xl p-3.5 md:p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                This Week
              </span>
              <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <CalendarDays className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg md:text-2xl font-bold text-blue-800 mt-1.5">
              {summaryQuery.isLoading ? "—" : fmtAED(sumData?.week.total ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {summaryQuery.isLoading
                ? "Calculating..."
                : `${sumData?.week.count ?? 0} payment${sumData?.week.count === 1 ? "" : "s"} this week`}
            </div>
          </div>

          {/* This Month Collection */}
          <div className="bg-white border border-gold-100 rounded-xl p-3.5 md:p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                This Month
              </span>
              <div className="w-7 h-7 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg md:text-2xl font-bold text-purple-800 mt-1.5">
              {summaryQuery.isLoading ? "—" : fmtAED(sumData?.month.total ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {summaryQuery.isLoading
                ? "Calculating..."
                : `${sumData?.month.count ?? 0} payment${sumData?.month.count === 1 ? "" : "s"} this month`}
            </div>
          </div>

          {/* This Year Collection */}
          <div className="bg-white border border-gold-100 rounded-xl p-3.5 md:p-4 shadow-xs relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                This Year
              </span>
              <div className="w-7 h-7 rounded-full bg-gold-50 text-gold-700 flex items-center justify-center">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="text-lg md:text-2xl font-bold text-gold-900 mt-1.5">
              {summaryQuery.isLoading ? "—" : fmtAED(sumData?.year.total ?? 0)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {summaryQuery.isLoading
                ? "Calculating..."
                : `${sumData?.year.count ?? 0} total payments this year`}
            </div>
          </div>
        </div>
      </ChartErrorBoundary>

      {/* Filter Bar */}
      <div className="bg-white border border-gold-100 rounded-xl p-4 shadow-xs space-y-3">
        {/* Row 1: Date quick buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(
            [
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "week", label: "This Week" },
              { id: "month", label: "This Month" },
              { id: "all", label: "All Time" },
              { id: "custom", label: "Custom" },
            ] as { id: DateFilterMode; label: string }[]
          ).map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setDateFilter(btn.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-all min-h-[36px] flex items-center justify-center ${
                dateFilter === btn.id
                  ? "bg-gold-500 text-white border-gold-600 shadow-xs"
                  : "bg-white text-muted-foreground border-gold-100 hover:bg-gold-50/60 hover:text-gold-900"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Custom date picker row (if custom is selected) */}
        {dateFilter === "custom" && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gold-50/40 border border-gold-100 flex-wrap">
            <CalendarIcon className="w-4 h-4 text-gold-700 shrink-0" />
            <span className="text-xs font-medium text-gold-900">Custom Date Range:</span>
            <div className="w-40">
              <DatePickerField
                value={customStart}
                onChange={setCustomStart}
                placeholder="Start Date"
                className="h-8 text-xs bg-white"
              />
            </div>
            <span className="text-xs text-muted-foreground">to</span>
            <div className="w-40">
              <DatePickerField
                value={customEnd}
                onChange={setCustomEnd}
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
                }}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-gold-900"
              >
                <X className="w-3.5 h-3.5 mr-1" /> Clear
              </Button>
            )}
          </div>
        )}

        {/* Row 2: Customer Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer by name, mobile, or ID (#...)"
            className="pl-9 bg-white text-sm"
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
      </div>

      {/* Results Header Info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <div>
          {collectionsQuery.isLoading
            ? "Loading collections..."
            : `Showing ${rawRows.length} of ${totalRecords} collection${totalRecords === 1 ? "" : "s"} ${
                debouncedSearch ? `· matching "${debouncedSearch}"` : ""
              }`}
        </div>
      </div>

      {/* Main Table: Grouped by Date */}
      <ChartErrorBoundary>
        <div className="space-y-4">
          {collectionsQuery.isLoading ? (
            <div className="bg-white border border-gold-100 rounded-xl p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto animate-spin text-gold-500 mb-2" />
              Loading collections...
            </div>
          ) : rawRows.length === 0 ? (
            <div className="bg-white border border-gold-100 rounded-xl p-8">
              <EmptyState
                icon={
                  search ? (
                    <Search className="w-10 h-10 text-gold-400" />
                  ) : (
                    <Inbox className="w-10 h-10 text-gold-400" />
                  )
                }
                title="No collections found for selected filters"
                description="Try clearing your search or selecting a different date range."
                action={
                  (dateFilter !== "all" || search) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDateFilter("all");
                        setSearch("");
                        setCustomStart("");
                        setCustomEnd("");
                      }}
                    >
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
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-gold-700 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gold-700 shrink-0" />
                      )}
                      <span className="font-semibold text-gold-900 text-sm">
                        {formatDateHeader(group.date)}
                      </span>
                      <span className="text-sm text-gold-600 font-medium">
                        — Total +{fmtAED(group.totalAmount)}
                      </span>
                      <span className="text-xs text-muted-foreground font-normal">
                        ({group.items.length} {group.items.length === 1 ? "payment" : "payments"})
                      </span>
                    </div>

                    <div className="text-right hidden sm:block">
                      <span className="font-bold text-emerald-700 text-sm">
                        +{fmtAED(group.totalAmount)}
                      </span>
                    </div>
                  </button>

                  {/* Content when expanded */}
                  {!isCollapsed && (
                    <>
                      {/* Mobile Card View */}
                      <div className="md:hidden space-y-2 p-3">
                        {group.items.map((p) => {
                          const orderId = p.order_id || p.orders?.id;
                          const cust = p.orders?.customers;
                          const custName = cust?.name ?? "—";
                          const custMobile = cust?.mobile;
                          const initial = custName.slice(0, 1).toUpperCase();

                          return (
                            <div
                              key={p.id}
                              onClick={() => orderId && setSelectedOrderId(orderId)}
                              className="border border-gold-100 rounded-lg p-3 bg-white shadow-xs hover:bg-gold-50/50 transition-colors cursor-pointer"
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-7 h-7 rounded-full bg-gold-100 text-gold-900 flex items-center justify-center text-xs font-bold shrink-0">
                                    {initial}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-xs text-gold-900 truncate">
                                      {custName}
                                    </div>
                                    {custMobile && (
                                      <div className="text-[10px] text-muted-foreground truncate">
                                        {custMobile}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="font-bold text-green-600 text-xs">
                                    +{fmtAED(p.amount)}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {formatDubaiTime(p.created_at)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gold-50 text-[11px] gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {orderId ? (
                                    <span className="font-mono text-gold-700 font-medium shrink-0">
                                      #{orderId}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                                {p.note && (
                                  <span className="truncate max-w-[140px] text-muted-foreground text-[10px] text-right">
                                    {p.note}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Table View */}
                      <div className="hidden md:block overflow-x-auto">
                        <div className="hidden md:block lg:hidden text-[10px] text-muted-foreground text-center py-1">
                          ← Swipe to see more →
                        </div>
                        <table className="w-full min-w-[700px] text-sm border-collapse">
                          <thead>
                            <tr className="bg-white text-[10px] uppercase tracking-wider text-muted-foreground border-b border-gold-50">
                              <th className="px-4 py-3 text-left font-medium w-[12%] min-w-[80px]">Time (Dubai)</th>
                              <th className="px-4 py-3 text-left font-medium w-[26%] min-w-[160px]">Customer</th>
                              <th className="px-4 py-3 text-left font-medium w-[16%] min-w-[120px]">Order ID</th>
                              <th className="px-4 py-3 text-right font-medium w-[14%] min-w-[100px]">Amount</th>
                              <th className="px-4 py-3 text-left font-medium w-[22%] min-w-[140px]">Note</th>
                              <th className="px-4 py-3 text-right font-medium w-[10%] min-w-[50px]">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gold-50">
                            {group.items.map((p) => {
                              const orderId = p.order_id || p.orders?.id;
                              const cust = p.orders?.customers;
                              const custName = cust?.name ?? "—";
                              const custMobile = cust?.mobile;
                              const initial = custName.slice(0, 1).toUpperCase();

                              return (
                                <tr
                                  key={p.id}
                                  className="hover:bg-gold-50/50 transition-colors"
                                >
                                  {/* Time */}
                                  <td className="px-4 py-3.5 align-middle text-xs text-muted-foreground whitespace-nowrap font-medium w-[12%] min-w-[80px]">
                                    {formatDubaiTime(p.created_at)}
                                  </td>

                                  {/* Customer with avatar */}
                                  <td className="px-4 py-3.5 align-middle w-[26%] min-w-[160px]">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-7 h-7 rounded-full bg-gold-100 text-gold-900 flex items-center justify-center text-xs font-bold shrink-0">
                                        {initial}
                                      </div>
                                      <div className="min-w-0 flex flex-col justify-center">
                                        <div className="font-semibold text-gold-900 text-xs truncate leading-tight">
                                          {custName}
                                        </div>
                                        {custMobile && (
                                          <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                                            {custMobile}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </td>

                                  {/* Order ID (Clickable) */}
                                  <td className="px-4 py-3.5 align-middle whitespace-nowrap w-[16%] min-w-[120px]">
                                    {orderId ? (
                                      <button
                                        type="button"
                                        onClick={() => setSelectedOrderId(orderId)}
                                        className="font-mono text-gold-700 hover:text-gold-900 hover:underline font-medium text-xs inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        #{orderId}
                                      </button>
                                    ) : (
                                      <span className="text-muted-foreground text-xs font-mono">—</span>
                                    )}
                                  </td>

                                  {/* Amount green +AED */}
                                  <td className="px-4 py-3.5 align-middle text-right whitespace-nowrap font-bold text-green-600 text-xs w-[14%] min-w-[100px]">
                                    +{fmtAED(p.amount)}
                                  </td>

                                  {/* Note */}
                                  <td className="px-4 py-3.5 align-middle text-xs text-muted-foreground truncate w-[22%] min-w-[140px] max-w-[220px]">
                                    <span className="block truncate" title={p.note || ""}>
                                      {p.note || "—"}
                                    </span>
                                  </td>

                                  {/* View Order icon */}
                                  <td className="px-4 py-3.5 align-middle text-right w-[10%] min-w-[50px]">
                                    {orderId && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="w-7 h-7 text-gold-700 hover:text-gold-900 hover:bg-gold-100 inline-flex items-center justify-center ml-auto"
                                        onClick={() => setSelectedOrderId(orderId)}
                                        title="View Order Details"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
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
            })
          )}

          {/* Pagination */}
          {totalRecords > PAGE_SIZE && (
            <div className="pt-2">
              <Pagination
                page={page}
                total={totalRecords}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            </div>
          )}
        </div>
      </ChartErrorBoundary>

      {/* Order Detail Sheet */}
      <OrderDetailSheet
        orderId={selectedOrderId}
        open={!!selectedOrderId}
        onOpenChange={(v) => {
          if (!v) setSelectedOrderId(null);
        }}
      />
    </div>
  );
}

