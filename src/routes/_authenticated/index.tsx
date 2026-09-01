import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Plus, Clock, Search, Wallet, TrendingDown, CheckCircle,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, ComposedChart,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { supabase, type Order, ACTIVE_ORDERS_FILTER } from "@/lib/supabase";
import { fmtAED, fmtAEDShort, fmtDate, dueOf, ONGOING_STATUSES } from "@/lib/format";
import { NewOrderModal } from "@/components/new-order-modal";
import { AdvancedSearchModal } from "@/components/advanced-search-modal";
import { OrderStatusBadge } from "@/components/status-badges";
import { OrderDetailSheet } from "@/components/order-detail-sheet";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const nav = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState<string | null>(null);

  const now = new Date();
  const start = format(startOfMonth(now), "yyyy-MM-dd");
  const end = format(endOfMonth(now), "yyyy-MM-dd");
  const prevD = subMonths(now, 1);
  const pStart = format(startOfMonth(prevD), "yyyy-MM-dd");
  const pEnd = format(endOfMonth(prevD), "yyyy-MM-dd");

  const monthly = useQuery({
    queryKey: ["dash-monthly-v3", start, end],
    queryFn: async () => {
      const [cur, prev, curExp, prevExp, crossPayments, prevCrossPayments] = await Promise.all([
        supabase.from("orders").select("*").or(ACTIVE_ORDERS_FILTER).gte("order_date", start).lte("order_date", end),
        supabase.from("orders").select("*").or(ACTIVE_ORDERS_FILTER).gte("order_date", pStart).lte("order_date", pEnd),
        supabase.from("expenses").select("amount").gte("expense_date", start).lte("expense_date", end),
        supabase.from("expenses").select("amount").gte("expense_date", pStart).lte("expense_date", pEnd),
        supabase.from("payments")
          .select("amount, payment_type, orders!inner(order_date)")
          .gte("payment_date", start).lte("payment_date", end)
          .eq("payment_type", "payment")
          .lt("orders.order_date", start),
        supabase.from("payments")
          .select("amount, payment_type, orders!inner(order_date)")
          .gte("payment_date", pStart).lte("payment_date", pEnd)
          .eq("payment_type", "payment")
          .lt("orders.order_date", pStart),
      ]);
      const sum = (rows: any[]) => {
        const total = rows.length;
        const ongoing = rows.filter((r) => ONGOING_STATUSES.includes(r.order_status)).length;
        const completed = rows.filter((r) => r.order_status === "Completed").length;
        const cancelled = rows.filter((r) => r.order_status === "Cancelled").length;
        const sales = rows.filter((r) => r.order_status !== "Cancelled").reduce((s, r) => s + Number(r.total_amount), 0);
        const collection = rows.filter((r) => r.order_status !== "Cancelled").reduce((s, r) => s + Number(r.advance_amount), 0);
        const due = rows.reduce((s, r) => s + dueOf(r), 0);
        return { total, ongoing, completed, cancelled, sales, collection, due };
      };
      const c = sum((cur.data ?? []) as Order[]);
      const p = sum((prev.data ?? []) as Order[]);
      const extraCollection = (crossPayments.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const prevExtraCollection = (prevCrossPayments.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const correctedCollection = c.collection + extraCollection;
      const prevCorrectedCollection = p.collection + prevExtraCollection;
      const expenses = (curExp.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      const prevExpenses = (prevExp.data ?? []).reduce((s: number, r: any) => s + Number(r.amount), 0);
      return {
        ...c, collection: correctedCollection, expenses, prevExpenses,
        chg: {
          sales: pct(c.sales, p.sales),
          collection: pct(correctedCollection, prevCorrectedCollection),
          expenses: pct(expenses, prevExpenses),
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


  const yearChart = useQuery({
    queryKey: ["dash-year-chart-v3", now.getFullYear()],
    queryFn: async () => {
      const y = now.getFullYear();
      const yStart = format(startOfYear(now), "yyyy-MM-dd");
      const yEnd = format(endOfYear(now), "yyyy-MM-dd");
      const [ordersRes, expensesRes, paymentsRes] = await Promise.all([
        supabase.from("orders").select("order_date, total_amount, advance_amount, order_status").or(ACTIVE_ORDERS_FILTER).gte("order_date", yStart).lte("order_date", yEnd),
        supabase.from("expenses").select("expense_date, amount").gte("expense_date", yStart).lte("expense_date", yEnd),
        supabase.from("payments").select("payment_date, amount, payment_type").gte("payment_date", yStart).lte("payment_date", yEnd).eq("payment_type", "payment"),
      ]);
      const months = Array.from({ length: 12 }, (_, i) => ({
        label: format(new Date(y, i, 1), "MMM"),
        sales: 0, expenses: 0, collection: 0,
      }));
      (ordersRes.data ?? []).forEach((o: any) => {
        if (o.order_status === "Cancelled") return;
        const idx = new Date(o.order_date).getMonth();
        months[idx].sales += Number(o.total_amount);
        months[idx].collection += Number(o.advance_amount);
      });
      (paymentsRes.data ?? []).forEach((p: any) => {
        const idx = new Date(p.payment_date).getMonth();
        months[idx].collection += Number(p.amount);
      });
      (expensesRes.data ?? []).forEach((e: any) => {
        const idx = new Date(e.expense_date).getMonth();
        months[idx].expenses += Number(e.amount);
      });
      return months.map((m) => ({ ...m, netProfit: m.collection - m.expenses }));
    },
  });


  const recent = useQuery({
    queryKey: ["dash-recent-v2"],
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*, customers(name)").or(ACTIVE_ORDERS_FILTER).order("created_at", { ascending: false }).limit(5);
      return (data ?? []) as Order[];
    },
  });

  const allOngoing = useQuery({
    queryKey: ["all-ongoing-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .or(ACTIVE_ORDERS_FILTER)
        .in("order_status", ONGOING_STATUSES);
      return count ?? 0;
    },
  });



  const greet = now.getHours() < 12 ? "Good Morning" : now.getHours() < 18 ? "Good Afternoon" : "Good Evening";
  const monthLabel = format(now, "MMMM yyyy");
  const netProfit = (monthly.data?.collection ?? 0) - (monthly.data?.expenses ?? 0);
  const isLoss = netProfit < 0;
  const profitLabel = isLoss ? "Net Loss" : "Net Profit";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-gold-900">{greet}! 👋</h2>
        <p className="text-sm text-muted-foreground">{format(now, "EEEE, dd/MM/yyyy")}</p>
      </div>


      {/* Quick Actions */}
      <div>
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <ActionCard onClick={() => setNewOpen(true)} border="border-t-gold-400" iconBg="bg-gold-50 text-gold-600" icon={<Plus className="w-5 h-5" />} label="New Order" subtitle="Create a new order" />
          <ActionCard onClick={() => nav({ to: "/expenses", search: { new: "1" } as any })} border="border-t-amber-400" iconBg="bg-amber-50 text-amber-600" icon={<Wallet className="w-5 h-5" />} label="New Expense" subtitle="Record an expense" />
          <ActionCard onClick={() => nav({ to: "/orders", search: { status: "Ongoing" } as any })} border="border-t-purple-500" iconBg="bg-purple-50 text-purple-600" icon={<Clock className="w-5 h-5" />} label="Ongoing Orders" subtitle={`${allOngoing.data ?? 0} in progress`} />
          <ActionCard onClick={() => setSearchOpen(true)} border="border-t-blue-500" iconBg="bg-blue-50 text-blue-600" icon={<Search className="w-5 h-5" />} label="Search Orders" subtitle="Find by ID or customer" />
        </div>
      </div>

      {/* All Time Total Due — Hero Banner */}
      <div>
        <SectionLabel>
          All Time Overview{" "}
          <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">OUTSTANDING</span>
        </SectionLabel>
        <div className="rounded-xl p-4 md:p-5 text-white shadow-[var(--shadow-card)] bg-gradient-to-br from-[#7a1f1f] via-[#a02c2c] to-[#5c1414]">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_45%] gap-4 items-center">
            <div>
              <div className="text-[10px] uppercase tracking-[0.08em] text-white/70">⚠ Lifetime Outstanding</div>
              <div className="text-sm font-semibold text-white/90 mt-0.5">All Time Total Due</div>
              <div className="text-2xl md:text-4xl font-bold mt-1">{fmtAED(allTimeDue.data?.total ?? 0)}</div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="text-[11px] bg-white/15 px-2.5 py-1 rounded-full">
                  Across {allTimeDue.data?.uniqueCustomers ?? 0} customers
                </span>
                {(allTimeDue.data?.oldestDays ?? 0) > 0 && (
                  <span className="text-[11px] bg-white/15 px-2.5 py-1 rounded-full">
                    Oldest pending: {allTimeDue.data?.oldestDays} days
                  </span>
                )}
              </div>
            </div>
            <div className="h-[110px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={allTimeDue.data?.monthlyDue ?? []}>
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.7)" }} axisLine={false} tickLine={false} />
                  <Line type="monotone" dataKey="due" stroke="#ffffff" strokeWidth={2} dot={{ r: 2, fill: "#fff" }} />
                  <Tooltip
                    formatter={(v: number) => fmtAED(v)}
                    contentStyle={{ background: "#7a1f1f", border: "none", color: "#fff", fontSize: 11 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly overview */}
      <div>
        <SectionLabel>{monthLabel.toUpperCase()} — Overview</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total Orders" value={String(monthly.data?.total ?? 0)} sub="This month" valueColor="text-gold-900" />
          <StatCard label="Total Sales" value={fmtAED(monthly.data?.sales ?? 0)} sub={chgLabel(monthly.data?.chg.sales)} valueColor="text-gold-700" />
          <StatCard label="Total Collection" value={fmtAED(monthly.data?.collection ?? 0)} sub={chgLabel(monthly.data?.chg.collection)} valueColor="text-purple-700" />
          <StatCard label="Monthly Due" value={fmtAED(monthly.data?.due ?? 0)} sub="Pending recovery (this month)" valueColor="text-red-600" />

          <StatCard label="Total Expenses" value={fmtAED(monthly.data?.expenses ?? 0)} sub={monthLabel} valueColor="text-amber-600" />
        </div>
      </div>

      {/* Net Profit */}
      <NetProfitCard
        title={<>🏆 Monthly {profitLabel}</>}
        subtitle="Collection − Expenses = Net Profit"
        monthLabel={monthLabel}
        collection={monthly.data?.collection ?? 0}
        expenses={monthly.data?.expenses ?? 0}
        netProfit={netProfit}
        profitLabel={profitLabel}
        yearData={yearChart.data ?? []}
      />

      {/* Sales vs Expenses */}
      <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-gold-900">Sales vs Expenses — {now.getFullYear()}</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <LegendDot color="#c19e65" /> Total Sales
            <LegendDot color="#dc2626" /> Total Expenses
          </div>
        </div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={yearChart.data ?? []}>
              <defs>
                <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c19e65" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#c19e65" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
              <Tooltip formatter={(v: number) => fmtAED(v)} />
              <Area type="monotone" dataKey="sales" stroke="none" fill="url(#salesFill)" />
              <Line type="monotone" dataKey="sales" name="Total Sales" stroke="#c19e65" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" name="Total Expenses" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white border border-gold-100 rounded-xl overflow-hidden shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between p-4 md:p-5">
          <div>
            <div className="font-semibold text-gold-900">Recent Orders</div>
            <div className="text-xs text-muted-foreground">Latest activity</div>
          </div>
          <Link to="/orders" className="text-sm text-gold-600 hover:text-gold-800">See all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gold-50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2 font-medium">Order ID</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(recent.data ?? []).map((o) => (
                <tr key={o.id} onClick={() => setOrderOpen(o.id)} className="border-t border-gold-50 hover:bg-gold-50/70 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-gold-700 text-xs">#{o.id}</td>
                  <td className="px-4 py-3 font-semibold text-gold-900">{(o.customers as any)?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(o.order_date)}</td>
                  <td className="px-4 py-3 text-right font-bold text-gold-700">{fmtAED(o.total_amount)}</td>
                  <td className="px-4 py-3"><OrderStatusBadge status={o.order_status} /></td>
                </tr>
              ))}
              {(recent.data ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewOrderModal open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOrderOpen(id)} />
      <AdvancedSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <OrderDetailSheet orderId={orderOpen} open={!!orderOpen} onOpenChange={(v) => { if (!v) setOrderOpen(null); }} />
    </div>
  );
}

function pct(cur: number, prev: number) {
  if (!prev) return cur ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}
function chgLabel(chg?: number) {
  if (chg === undefined) return "vs last month";
  const arrow = chg >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(chg)}% vs last month`;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-[0.08em] text-gold-500 font-semibold mb-2 mt-1">{children}</div>;
}

function ActionCard({ onClick, border, icon, iconBg, label, subtitle }: {
  onClick: () => void; border: string; icon: React.ReactNode; iconBg: string; label: string; subtitle: string;
}) {
  return (
    <button onClick={onClick} className={`bg-white rounded-xl border border-gold-100 border-t-4 ${border} p-4 text-left hover:shadow-[var(--shadow-elegant)] transition-shadow min-h-[110px]`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${iconBg}`}>{icon}</div>
      <div className="font-semibold text-gold-900 text-sm">{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
    </button>
  );
}

function StatCard({ label, value, sub, valueColor }: { label: string; value: string; sub: string; valueColor: string }) {
  return (
    <div className="bg-white border border-gold-100 rounded-[10px] p-3 md:p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg md:text-xl font-bold mt-1 ${valueColor}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: color }} />;
}

export function NetProfitCard({
  title, subtitle, monthLabel, collection, expenses, netProfit, profitLabel, yearData, headerBadge,
}: {
  title: React.ReactNode; subtitle: string; monthLabel: string;
  collection: number; expenses: number; netProfit: number; profitLabel: string;
  yearData: { label: string; collection: number; expenses: number; netProfit: number }[];
  headerBadge?: React.ReactNode;
}) {
  const isLoss = netProfit < 0;
  const absProfit = Math.abs(netProfit);
  const totalBase = Math.max(1, absProfit + expenses);
  const profitPctVal = Math.round((absProfit / totalBase) * 100);
  const expPctVal = 100 - profitPctVal;
  const donutData = [
    { name: profitLabel, value: absProfit, color: isLoss ? "#dc2626" : "#16a34a" },
    { name: "Expenses", value: expenses, color: "#ef4444" },
  ];

  return (
    <div className="bg-white border border-gold-100 rounded-xl p-4 md:p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-bold text-[15px] text-gold-900">{title}</div>
          <div className="text-xs italic text-purple-600/80 mt-0.5">{subtitle}</div>
        </div>
        <div className="flex items-center gap-2">
          {headerBadge}
          <span className="text-xs font-medium bg-purple-50 text-purple-700 px-3 py-1 rounded-full">{monthLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[35%_1fr] gap-5">
        {/* Donut */}
        <div className="flex flex-col items-center">
          <div className="relative w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} dataKey="value" innerRadius={70} outerRadius={100} startAngle={90} endAngle={-270} stroke="none">
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmtAED(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{profitLabel}</div>
              <div className={`text-[20px] font-bold ${isLoss ? "text-red-600" : "text-purple-700"}`}>{fmtAED(absProfit)}</div>
              <div className="text-[10px] text-muted-foreground">AED · {monthLabel}</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs mt-2">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: isLoss ? "#dc2626" : "#16a34a" }} /> {isLoss ? "Loss" : "Profit"} {profitPctVal}%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500" /> Expenses {expPctVal}%</span>
          </div>
        </div>

        {/* Stats + bar */}
        <div>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            <NPStat icon={<Wallet className="w-4 h-4" />} iconBg="bg-amber-50 text-amber-600" label="Collection" shortLabel="COLLECT." value={collection} valueColor="text-green-600" />
            <NPStat icon={<TrendingDown className="w-4 h-4" />} iconBg="bg-red-50 text-red-600" label="Expenses" value={expenses} valueColor="text-red-600" />
            <NPStat icon={<CheckCircle className="w-4 h-4" />} iconBg="bg-purple-100 text-purple-600" label={profitLabel} value={absProfit} valueColor={isLoss ? "text-red-600" : "text-purple-700"} highlight />
          </div>
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Profit Health Meter</div>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearData} barGap={2} barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0e5d0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtAEDShort(v)} />
                  <Tooltip formatter={(v: number) => fmtAED(v)} />
                  <Bar dataKey="collection" fill="#16a34a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="netProfit" fill="#7c3aed" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NPStat({ icon, iconBg, label, shortLabel, value, valueColor, highlight }: {
  icon: React.ReactNode; iconBg: string; label: string; shortLabel?: string; value: number; valueColor: string; highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg p-2 sm:p-3 border min-w-0 overflow-hidden ${highlight ? "bg-purple-50 border-purple-200" : "bg-white border-gold-100"}`}>
      <div className="flex items-center gap-1 sm:gap-2 mb-1 min-w-0">
        <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</span>
        <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground truncate">
          <span className="sm:hidden">{shortLabel ?? label}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
      </div>
      <div className={`text-[13px] sm:text-[22px] font-bold leading-tight truncate ${valueColor}`}>{fmtAED(value).replace("AED ", "")}</div>
      <div className="text-[9px] sm:text-[10px] text-muted-foreground">AED</div>
    </div>
  );
}
