import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import {
  ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Package, Clock, CheckCircle2,
  TrendingUp, Wallet, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase, type Order, type Expense, ACTIVE_ORDERS_FILTER } from "@/lib/supabase";
import { fmtAED, fmtAEDShort, fmtDate, listMonthsSince, monthKey, dueOf, ONGOING_STATUSES, displayPaymentStatus } from "@/lib/format";
import { toast } from "sonner";
import { NetProfitCard, SectionLabel } from "./index";
import { ChartErrorBoundary } from "@/components/chart-error-boundary";

export const Route = createFileRoute("/_authenticated/reports")({
  ssr: false,
  component: ReportsPage,
});

const CAT_COLORS = ["#c19e65", "#7c3aed", "#16a34a", "#dc2626", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6"];

function ReportsPage() {
  const months = useMemo(() => listMonthsSince(2025), []);
  const [selected, setSelected] = useState(monthKey(new Date()));
  const selectedDate = months.find((m) => m.value === selected)!.date;
  const monthLabel = months.find((m) => m.value === selected)?.label ?? "";

  const shift = (dir: -1 | 1) => {
    const d = addMonths(selectedDate, dir);
    const k = monthKey(d);
    if (months.some((m) => m.value === k)) setSelected(k);
  };

  const start = format(startOfMonth(selectedDate), "yyyy-MM-dd");
  const end = format(endOfMonth(selectedDate), "yyyy-MM-dd");
  const prevDate = subMonths(selectedDate, 1);
  const prevStart = format(startOfMonth(prevDate), "yyyy-MM-dd");
  const prevEnd = format(endOfMonth(prevDate), "yyyy-MM-dd");

  const kpis = useQuery({
    queryKey: ["report-kpis-v3", selected],
    queryFn: async () => {
      const [
        thisM, lastM, curExp, prevExp,
        paymentsThisMonth, paymentsPrevMonth,
      ] = await Promise.all([
        supabase.from("orders").select("*, customers(name)").or(ACTIVE_ORDERS_FILTER).gte("order_date", start).lte("order_date", end),
        supabase.from("orders").select("*").or(ACTIVE_ORDERS_FILTER).gte("order_date", prevStart).lte("order_date", prevEnd),
        supabase.from("expenses").select("amount").gte("expense_date", start).lte("expense_date", end),
        supabase.from("expenses").select("amount").gte("expense_date", prevStart).lte("expense_date", prevEnd),
        supabase.from("payments").select("amount")
          .gte("payment_date", start).lte("payment_date", end)
          .eq("payment_type", "payment"),
        supabase.from("payments").select("amount")
          .gte("payment_date", prevStart).lte("payment_date", prevEnd)
          .eq("payment_type", "payment"),
      ]);
      const cur = (thisM.data ?? []) as Order[];
      const prev = (lastM.data ?? []) as Order[];
      const summarize = (rows: Order[]) => {
        const totOrders = rows.length;
        const ongoing = rows.filter((o) => ONGOING_STATUSES.includes(o.order_status)).length;
        const completed = rows.filter((o) => o.order_status === "Completed").length;
        const cancelled = rows.filter((o) => o.order_status === "Cancelled").length;
        const sales = rows.filter((o) => o.order_status !== "Cancelled").reduce((s, o) => s + Number(o.total_amount), 0);
        const due = rows.reduce((s, o) => s + dueOf(o), 0);
        return { totOrders, ongoing, completed, cancelled, sales, due };
      };
      const c = summarize(cur);
      const p = summarize(prev);

      const collection = (paymentsThisMonth.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const prevCollection = (paymentsPrevMonth.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);

      const expenses = (curExp.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const prevExpenses = (prevExp.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      return {
        rows: cur, ...c, collection, expenses, prevExpenses,
        chg: {
          totOrders: pct(c.totOrders, p.totOrders),
          sales: pct(c.sales, p.sales),
          collection: pct(collection, prevCollection),
        },
      };
    },
  });

  const allTimeDue = useQuery({
    queryKey: ["all-time-due"],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("total_amount, advance_amount, discount_amount, order_status, order_date, customer_id")
        .or(ACTIVE_ORDERS_FILTER)
        .neq("order_status", "Cancelled");
      const orders = (data ?? []) as any[];
      const ordersWithDue = orders.filter((o) => dueOf(o) > 0);
      const total = ordersWithDue.reduce((s, o) => s + dueOf(o), 0);
      const uniqueCustomers = new Set(ordersWithDue.map((o) => o.customer_id)).size;
      const highestDue = ordersWithDue.reduce((max, o) => Math.max(max, dueOf(o)), 0);
      const oldestDate = ordersWithDue.reduce<Date | null>((oldest, o) => {
        const d = new Date(o.order_date);
        return oldest === null || d < oldest ? d : oldest;
      }, null);
      const oldestDays = oldestDate ? Math.floor((Date.now() - oldestDate.getTime()) / 86400000) : 0;
      const byMonthMap: Record<string, number> = {};
      ordersWithDue.forEach((o) => {
        const key = String(o.order_date).slice(0, 7);
        byMonthMap[key] = (byMonthMap[key] ?? 0) + dueOf(o);
      });
      const y = new Date().getFullYear();
      const monthlyDue = Array.from({ length: 12 }, (_, i) => {
        const key = `${y}-${String(i + 1).padStart(2, "0")}`;
        return { label: format(new Date(y, i, 1), "MMM"), due: byMonthMap[key] ?? 0 };
      });
      return { total, uniqueCustomers, highestDue, oldestDays, monthlyDue };
    },
  });

  const yearData = useQuery({
    queryKey: ["report-year-v3", selectedDate.getFullYear()],
    queryFn: async () => {
      const y = selectedDate.getFullYear();
      const yStart = `${y}-01-01`;
      const yEnd = `${y}-12-31`;
      const [ordersRes, expensesRes, paymentsRes] = await Promise.all([
        supabase.from("orders").select("id, order_date, total_amount, order_status").or(ACTIVE_ORDERS_FILTER).gte("order_date", yStart).lte("order_date", yEnd),
        supabase.from("expenses").select("expense_date, amount").gte("expense_date", yStart).lte("expense_date", yEnd),
        supabase.from("payments").select("payment_date, amount, payment_type").gte("payment_date", yStart).lte("payment_date", yEnd).eq("payment_type", "payment"),
      ]);
      const months12 = Array.from({ length: 12 }, (_, i) => ({
        i, label: format(new Date(y, i, 1), "MMM"),
        orders: 0, sales: 0, collection: 0, expenses: 0,
      }));
      (ordersRes.data ?? []).forEach((o: any) => {
        const idx = new Date(o.order_date).getMonth();
        months12[idx].orders += 1;
        if (o.order_status !== "Cancelled") {
          months12[idx].sales += Number(o.total_amount);
        }
      });

      (paymentsRes.data ?? []).forEach((p: any) => {
        const idx = new Date(p.payment_date).getMonth();
        months12[idx].collection += Number(p.amount);
      });
      (expensesRes.data ?? []).forEach((e: any) => {
        const idx = new Date(e.expense_date).getMonth();
        months12[idx].expenses += Number(e.amount);
      });
      return months12.map((m) => ({ ...m, netProfit: m.collection - m.expenses }));
    },
  });


  const expensesQ = useQuery({
    queryKey: ["report-expenses-v2", selected],
    queryFn: async () => {
      const { data } = await supabase.from("expenses").select("*").gte("expense_date", start).lte("expense_date", end).order("expense_date", { ascending: false });
      const rows = (data ?? []) as Expense[];
      const total = rows.reduce((s, r) => s + Number(r.amount), 0);
      const byCat: Record<string, number> = {};
      rows.forEach((r) => { byCat[r.category] = (byCat[r.category] ?? 0) + Number(r.amount); });
      return { rows, total, byCat };
    },
  });

  const cur = kpis.data;
  const monthIdx = selectedDate.getMonth();
  const netProfit = (cur?.collection ?? 0) - (cur?.expenses ?? 0);
  const isLoss = netProfit < 0;
  const profitLabel = isLoss ? "Net Loss" : "Net Profit";

  const exportPDF = async () => {
    try {
      const jsPDFModule = await import("jspdf");
      const { jsPDF } = jsPDFModule;
      const pdf = new jsPDF("p", "mm", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      let y = 18;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.setTextColor(120, 60, 10);
      pdf.text("FABRINEST CURTAINS", pageW / 2, y, { align: "center" });
      y += 7;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(80, 60, 30);
      pdf.text(`Monthly Report — ${monthLabel}`, pageW / 2, y, { align: "center" });
      y += 5;

      pdf.setFontSize(8);
      pdf.setTextColor(130);
      pdf.text(`Generated: ${format(new Date(), "dd MMM yyyy 'at' hh:mm a")}`, pageW / 2, y, { align: "center" });
      y += 8;

      pdf.setDrawColor(193, 158, 101);
      pdf.setLineWidth(0.6);
      pdf.line(10, y, pageW - 10, y);
      y += 8;

      const sectionHeading = (title: string) => {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(120, 60, 10);
        pdf.text(title, 10, y);
        y += 6;
      };

      const kvRow = (label: string, value: string, valueColor?: [number, number, number]) => {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        pdf.setTextColor(80);
        pdf.text(label, 16, y);
        pdf.setFont("helvetica", "bold");
        if (valueColor) pdf.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
        else pdf.setTextColor(40);
        pdf.text(value, pageW - 14, y, { align: "right" });
        y += 6;
      };

      const thinDivider = () => {
        pdf.setDrawColor(230, 215, 190);
        pdf.setLineWidth(0.3);
        pdf.line(10, y, pageW - 10, y);
        y += 7;
      };

      sectionHeading("ORDER STATISTICS");
      kvRow("Total Orders", String(cur?.totOrders ?? 0));
      kvRow("Ongoing Orders", String(cur?.ongoing ?? 0), [180, 120, 0]);
      kvRow("Completed Orders", String(cur?.completed ?? 0), [22, 163, 74]);
      kvRow("Cancelled Orders", String(cur?.cancelled ?? 0), [220, 38, 38]);
      thinDivider();

      sectionHeading("FINANCIAL OVERVIEW");
      kvRow("Total Sales", fmtAED(cur?.sales ?? 0));
      kvRow("Total Collection", fmtAED(cur?.collection ?? 0), [124, 58, 237]);
      kvRow("Monthly Due", fmtAED(cur?.due ?? 0), [220, 38, 38]);
      kvRow("Total Expenses", fmtAED(cur?.expenses ?? 0), [220, 38, 38]);
      kvRow(isLoss ? "Net Loss" : "Net Profit", fmtAED(Math.abs(netProfit)), isLoss ? [220, 38, 38] : [22, 163, 74]);
      thinDivider();

      sectionHeading("ALL TIME OUTSTANDING DUE");
      kvRow("Total Outstanding Due", fmtAED(allTimeDue.data?.total ?? 0), [220, 38, 38]);
      kvRow("Customers with Due", String(allTimeDue.data?.uniqueCustomers ?? 0));
      kvRow("Highest Single Due", fmtAED(allTimeDue.data?.highestDue ?? 0), [220, 38, 38]);
      kvRow("Oldest Pending", `${allTimeDue.data?.oldestDays ?? 0} days`, [180, 120, 0]);
      thinDivider();

      if ((cur?.rows ?? []).length > 0) {
        sectionHeading("ORDER DETAILS");
        const colX = [10, 38, 88, 120, 148, 176];
        const cols = ["Order ID", "Customer", "Date", "Total (AED)", "Due (AED)", "Status"];
        pdf.setFillColor(240, 229, 208);
        pdf.rect(10, y - 4, pageW - 20, 7, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(100, 70, 20);
        cols.forEach((col, i) => pdf.text(col, colX[i], y));
        y += 7;

        (cur?.rows ?? []).forEach((o: any) => {
          if (y > pageH - 20) {
            pdf.addPage();
            y = 15;
          }
          const due = dueOf(o);
          const rowData = [
            `#${o.id}`.slice(0, 12),
            ((o as any).customers?.name ?? "—").slice(0, 22),
            fmtDate(o.order_date),
            Number(o.total_amount).toLocaleString("en-US"),
            due > 0 ? due.toLocaleString("en-US") : "—",
            o.order_status,
          ];
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(8);
          pdf.setTextColor(60);
          rowData.forEach((val, i) => pdf.text(val, colX[i], y));
          y += 6;
        });

        y += 3;
        thinDivider();
      }

      const expByCat = expensesQ.data?.byCat ?? {};
      if (Object.keys(expByCat).length > 0) {
        sectionHeading("EXPENSE BREAKDOWN");
        const total = expensesQ.data?.total ?? 0;
        Object.entries(expByCat)
          .sort((a, b) => b[1] - a[1])
          .forEach(([cat, amt]) => {
            const pctShare = total ? ((amt / total) * 100).toFixed(1) : "0.0";
            kvRow(`${cat} (${pctShare}%)`, fmtAED(amt));
          });
        kvRow("TOTAL EXPENSES", fmtAED(total), [120, 60, 10]);
        thinDivider();
      }

      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(7.5);
      pdf.setTextColor(160);
      pdf.text("Fabrinest Curtains — Confidential Business Report", pageW / 2, pageH - 6, { align: "center" });

      pdf.save(`Fabrinest-Report-${monthLabel.replace(" ", "-")}.pdf`);
      toast.success("PDF exported successfully!");
    } catch (e: any) {
      console.error("PDF export error:", e);
      toast.error("PDF export failed. Please try again.");
    }
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const reportDate = format(new Date(), "dd MMM yyyy 'at' hh:mm a");

      const summaryRows = [
        ["FABRINEST CURTAINS — MONTHLY REPORT"],
        [`Period: ${monthLabel}`],
        [`Generated: ${reportDate}`],
        [],
        ["ORDER STATISTICS", ""],
        ["Total Orders", cur?.totOrders ?? 0],
        ["Ongoing Orders", cur?.ongoing ?? 0],
        ["Completed Orders", cur?.completed ?? 0],
        ["Cancelled Orders", cur?.cancelled ?? 0],
        [],
        ["FINANCIAL OVERVIEW", ""],
        ["Total Sales (AED)", cur?.sales ?? 0],
        ["Total Collection (AED)", cur?.collection ?? 0],
        ["Monthly Due (AED)", cur?.due ?? 0],
        ["Total Expenses (AED)", cur?.expenses ?? 0],
        [isLoss ? "Net Loss (AED)" : "Net Profit (AED)", Math.abs(netProfit)],
        [],
        ["ALL TIME OUTSTANDING", ""],
        ["Total Outstanding Due (AED)", allTimeDue.data?.total ?? 0],
        ["Customers with Due", allTimeDue.data?.uniqueCustomers ?? 0],
        ["Highest Single Due (AED)", allTimeDue.data?.highestDue ?? 0],
        ["Oldest Pending (days)", allTimeDue.data?.oldestDays ?? 0],
      ];
      const summaryWS = XLSX.utils.aoa_to_sheet(summaryRows);
      summaryWS["!cols"] = [{ wch: 35 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, summaryWS, "Financial Summary");

      const orderRows = [
        ["Order ID", "Customer", "Mobile", "Order Date", "Total (AED)", "Advance (AED)", "Discount (AED)", "Due (AED)", "Order Status", "Payment Status"],
        ...(cur?.rows ?? []).map((o) => [
          `#${o.id}`,
          (o as any).customers?.name ?? "",
          (o as any).customers?.mobile ?? "",
          fmtDate(o.order_date),
          Number(o.total_amount),
          Number(o.advance_amount),
          Number(o.discount_amount ?? 0),
          dueOf(o),
          o.order_status,
          displayPaymentStatus(o),
        ]),
      ];
      const ordersWS = XLSX.utils.aoa_to_sheet(orderRows);
      ordersWS["!cols"] = [
        { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 14 },
        { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 12 },
        { wch: 18 }, { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, ordersWS, "Order Details");

      const expRows = [
        ["Date", "Title", "Category", "Amount (AED)", "Notes"],
        ...(expensesQ.data?.rows ?? []).map((e) => [
          fmtDate(e.expense_date),
          e.title,
          e.category,
          Number(e.amount),
          (e as any).description ?? "",
        ]),
        [],
        ["TOTAL", "", "", expensesQ.data?.total ?? 0],
      ];
      const expWS = XLSX.utils.aoa_to_sheet(expRows);
      expWS["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, expWS, "Expense Details");

      const catTotal = expensesQ.data?.total ?? 0;
      const catRows = [
        ["Category", "Amount (AED)", "Share (%)"],
        ...Object.entries(expensesQ.data?.byCat ?? {})
          .sort((a, b) => b[1] - a[1])
          .map(([cat, amt]) => [
            cat,
            amt,
            catTotal ? parseFloat(((amt / catTotal) * 100).toFixed(1)) : 0,
          ]),
        [],
        ["TOTAL", catTotal, 100],
      ];
      const catWS = XLSX.utils.aoa_to_sheet(catRows);
      catWS["!cols"] = [{ wch: 25 }, { wch: 16 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, catWS, "Expense by Category");

      const trendRows = [
        ["Month", "Orders", "Sales (AED)", "Collection (AED)", "Expenses (AED)", "Net Profit (AED)"],
        ...(yearData.data ?? []).map((m) => [
          m.label,
          m.orders,
          m.sales,
          m.collection,
          m.expenses,
          m.netProfit,
        ]),
      ];
      const trendWS = XLSX.utils.aoa_to_sheet(trendRows);
      trendWS["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, trendWS, `Monthly Trend ${selectedDate.getFullYear()}`);

      XLSX.writeFile(wb, `Fabrinest-Report-${monthLabel.replace(" ", "-")}.xlsx`);
      toast.success("Excel exported — 5 sheets ready!");
    } catch (e: any) {
      console.error("Excel export error:", e);
      toast.error("Excel export failed. Please try again.");
    }
  };


  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportExcel} className="border-gold-300 text-gold-700 hover:bg-gold-50">
            <FileSpreadsheet className="w-4 h-4" /> Export Excel
          </Button>
          <Button onClick={exportPDF} className="gold-gradient text-white hover:opacity-90">
            <FileDown className="w-4 h-4" /> Export PDF
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Order Statistics */}
        <div>
          <SectionLabel>Order Statistics — {monthLabel}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <BorderStat borderColor="border-l-blue-500" icon={<Package className="w-4 h-4" />} iconBg="bg-blue-50 text-blue-600" label="Total Orders" value={String(cur?.totOrders ?? 0)} valueColor="text-blue-700" sub="All orders this month" chg={cur?.chg.totOrders} />
            <BorderStat borderColor="border-l-amber-500" icon={<Clock className="w-4 h-4" />} iconBg="bg-amber-50 text-amber-600" label="Ongoing Orders" value={String(cur?.ongoing ?? 0)} valueColor="text-amber-600" sub={`${pctOf(cur?.ongoing, cur?.totOrders)}% of total orders`} />
            <BorderStat borderColor="border-l-green-500" icon={<CheckCircle2 className="w-4 h-4" />} iconBg="bg-green-50 text-green-600" label="Completed Orders" value={String(cur?.completed ?? 0)} valueColor="text-green-600" sub={`${pctOf(cur?.completed, cur?.totOrders)}% of total orders`} />
          </div>
        </div>

        {/* Financial Overview */}
        <div>
          <SectionLabel>Financial Overview — {monthLabel}</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <BorderStat borderColor="border-l-gold-400" icon={<TrendingUp className="w-4 h-4" />} iconBg="bg-gold-50 text-gold-700" label="Total Sales" value={fmtAED(cur?.sales ?? 0)} valueColor="text-gold-700" sub="" chg={cur?.chg.sales} />
            <BorderStat borderColor="border-l-purple-500" icon={<Wallet className="w-4 h-4" />} iconBg="bg-purple-50 text-purple-600" label="Total Collection" value={fmtAED(cur?.collection ?? 0)} valueColor="text-purple-700" sub="" chg={cur?.chg.collection} />
            <BorderStat borderColor="border-l-red-500" icon={<AlertCircle className="w-4 h-4" />} iconBg="bg-red-50 text-red-600" label="Monthly Due" value={fmtAED(cur?.due ?? 0)} valueColor="text-red-600" sub="Recovery pending (this month)" />
          </div>
        </div>

        {/* All Time Due Overview */}
        <div>
          <SectionLabel>
            All Time Due Overview{" "}
            <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">NEW</span>
          </SectionLabel>
          <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left: Number + sub-stats */}
              <div>
                <div className="font-semibold text-gold-900">Total Outstanding Due</div>
                <div className="text-xs text-muted-foreground">All customers · Since business start</div>
                <div className="text-2xl md:text-3xl font-bold text-red-600 mt-2">
                  {fmtAED(allTimeDue.data?.total ?? 0)}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-4">
                  <div className="rounded-lg border border-gold-100 p-2.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Customers with due</div>
                    <div className="text-base font-bold text-gold-900 mt-0.5">{allTimeDue.data?.uniqueCustomers ?? 0}</div>
                  </div>
                  <div className="rounded-lg border border-gold-100 p-2.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Highest single due</div>
                    <div className="text-base font-bold text-red-600 mt-0.5">{fmtAED(allTimeDue.data?.highestDue ?? 0)}</div>
                  </div>
                  <div className="rounded-lg border border-gold-100 p-2.5">
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Oldest pending</div>
                    <div className="text-base font-bold text-amber-600 mt-0.5">{allTimeDue.data?.oldestDays ?? 0} days</div>
                  </div>
                </div>
              </div>

              {/* Right: Full trend line chart */}
              <div>
                <div className="text-xs font-semibold text-gold-900 mb-1">Monthly Due Trend — {new Date().getFullYear()}</div>
                <div className="h-[180px]">
                  <ChartErrorBoundary>
                    {!(allTimeDue.data?.monthlyDue && allTimeDue.data.monthlyDue.length > 0) ? (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No due trend data available</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={allTimeDue.data?.monthlyDue ?? []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
                          <Tooltip formatter={(v: number) => fmtAED(v)} />
                          <Line type="monotone" dataKey="due" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </ChartErrorBoundary>
                </div>
              </div>
            </div>
          </div>
        </div>



        {/* Net Profit */}
        <NetProfitCard
          title={<>🏆 Monthly {profitLabel} — {monthLabel}</>}
          subtitle="Collection − Expenses = Net Profit"
          monthLabel={monthLabel}
          collection={cur?.collection ?? 0}
          expenses={cur?.expenses ?? 0}
          netProfit={netProfit}
          profitLabel={profitLabel}
          yearData={yearData.data ?? []}
          headerBadge={
            <span className={`text-xs font-medium px-3 py-1 rounded-full ${isLoss ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {isLoss ? "Loss Month ⚠️" : "Profitable Month ✅"}
            </span>
          }
        />

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-gold-100 rounded-xl p-4">
            <div className="font-semibold text-gold-900 mb-3">Monthly Orders ({selectedDate.getFullYear()})</div>
            <div className="h-[180px]">
              <ChartErrorBoundary>
                {!(yearData.data && yearData.data.length > 0) ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No order data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yearData.data ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "rgba(193,158,101,0.1)" }} />
                      <Bar dataKey="orders" radius={[6, 6, 0, 0]}>
                        {(yearData.data ?? []).map((e) => <Cell key={e.i} fill={e.i === monthIdx ? "#c19e65" : "#f0e4cc"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ChartErrorBoundary>
            </div>
          </div>

          <div className="bg-white border border-gold-100 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-semibold text-gold-900">Sales vs Collection</div>
                <div className="text-xs text-muted-foreground">Financial flow — {selectedDate.getFullYear()}</div>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Dot color="#c19e65" /> Sales
                <Dot color="#7c3aed" /> Collection
              </div>
            </div>
            <div className="h-[180px]">
              <ChartErrorBoundary>
                {!(yearData.data && yearData.data.length > 0) ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No financial flow data available</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={yearData.data ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
                      <Tooltip formatter={(v: number) => fmtAED(v)} />
                      <Line type="monotone" dataKey="sales" stroke="#c19e65" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="collection" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartErrorBoundary>
            </div>
          </div>
        </div>

        {/* Order Status Breakdown */}
        <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5">
          <div className="mb-3">
            <div className="font-semibold text-gold-900">Order Status Breakdown</div>
            <div className="text-xs text-muted-foreground">{monthLabel} — Distribution</div>
          </div>
          <div className="space-y-3">
            <StatusBar dotColor="bg-amber-500" barColor="bg-amber-500" label="Ongoing" value={cur?.ongoing ?? 0} total={cur?.totOrders ?? 0} />
            <StatusBar dotColor="bg-green-500" barColor="bg-green-500" label="Completed" value={cur?.completed ?? 0} total={cur?.totOrders ?? 0} />
            <StatusBar dotColor="bg-red-500" barColor="bg-red-500" label="Cancelled" value={cur?.cancelled ?? 0} total={cur?.totOrders ?? 0} />
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold text-gold-900">Expense Breakdown — {monthLabel}</div>
              <div className="text-xs text-muted-foreground">Category wise spending analysis</div>
            </div>
            <span className="text-xs font-semibold bg-gold-50 text-gold-700 border border-gold-200 px-3 py-1 rounded-full">
              Total {fmtAED(expensesQ.data?.total ?? 0)}
            </span>
          </div>
          {Object.keys(expensesQ.data?.byCat ?? {}).length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No expenses recorded.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gold-50 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-medium">Category</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-right px-3 py-2 font-medium">% Share</th>
                    <th className="text-left px-3 py-2 font-medium w-[35%]">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(expensesQ.data!.byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt], i) => {
                    const p = expensesQ.data!.total ? (amt / expensesQ.data!.total) * 100 : 0;
                    const color = CAT_COLORS[i % CAT_COLORS.length];
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
                    <td className="px-3 py-2 text-right font-bold text-gold-700">{fmtAED(expensesQ.data!.total)}</td>
                    <td className="px-3 py-2 text-right font-bold">100%</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Monthly Profit History */}
        <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="font-semibold text-gold-900">Monthly Profit History — {selectedDate.getFullYear()}</div>
              <div className="text-xs text-muted-foreground">Collection vs Expenses vs Net Profit per month</div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Dot color="#16a34a" /> Collection
              <Dot color="#ef4444" /> Expenses
              <Dot color="#7c3aed" /> Net Profit
            </div>
          </div>
          <div className="h-[200px]">
            <ChartErrorBoundary>
              {!(yearData.data && yearData.data.length > 0) ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No profit history data available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearData.data ?? []} barGap={2} barCategoryGap="18%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
                    <Tooltip formatter={(v: number) => fmtAED(v)} />
                    <Bar dataKey="collection" fill="#16a34a" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expenses" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="netProfit" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}

function pct(cur: number, prev: number) {
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}
function pctOf(a?: number, b?: number) {
  if (!b) return 0;
  return Math.round(((a ?? 0) / b) * 100);
}

function BorderStat({ borderColor, icon, iconBg, label, value, valueColor, sub, chg }: {
  borderColor: string; icon: React.ReactNode; iconBg: string; label: string; value: string; valueColor: string; sub: string; chg?: number;
}) {
  const isUp = (chg ?? 0) >= 0;
  return (
    <div className={`bg-white border border-gold-100 border-l-4 ${borderColor} rounded-xl p-4`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${iconBg}`}>{icon}</div>
      </div>
      <div className={`text-xl md:text-2xl font-bold mt-1 ${valueColor}`}>{value}</div>
      {chg !== undefined ? (
        <div className={`text-xs mt-2 inline-flex items-center gap-1 ${isUp ? "text-green-700" : "text-red-700"}`}>
          {isUp ? "▲" : "▼"} {Math.abs(chg)}% vs last month
        </div>
      ) : sub ? (
        <div className="text-xs text-muted-foreground mt-2">{sub}</div>
      ) : null}
    </div>
  );
}

function StatusBar({ label, value, total, dotColor, barColor }: {
  label: string; value: number; total: number; dotColor: string; barColor: string;
}) {
  const p = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1.5">
        <span className="flex items-center gap-2 text-gold-900 font-medium">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} /> {label}
        </span>
        <span className="text-muted-foreground">{value} orders — {p}%</span>
      </div>
      <div className="h-2 rounded-full bg-gold-100 overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: color }} />;
}
