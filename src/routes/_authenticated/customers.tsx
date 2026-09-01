import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Search, Users, ArrowDownLeft, ArrowUpRight, GitBranch, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase, type Customer, type Order, type Payment, type OrderStatusHistory, ACTIVE_ORDERS_FILTER, sanitizeSearch } from "@/lib/supabase";
import { fmtAED, fmtDate, fmtDateTime, dueOf, ONGOING_STATUSES, isOngoing } from "@/lib/format";
import { OrderStatusBadge } from "@/components/status-badges";
import { RoomsDisplay } from "@/components/rooms-editor";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { OrderForm } from "@/components/order-form";
import { useDebouncedValue } from "@/hooks/use-debounce";

const search = z.object({ open: z.string().optional() });

export const Route = createFileRoute("/_authenticated/customers")({
  ssr: false,
  validateSearch: search,
  component: CustomersPage,
});

type Filter = "All" | "Ongoing" | "Completed" | "Cancelled" | "Due";
const PAGE_SIZE = 10;
type Row = Customer & { last_order?: Order | null; order_count: number; total_due: number };

function CustomersPage() {
  const routeSearch = useSearch({ from: "/_authenticated/customers" });
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [filter, setFilter] = useState<Filter>("All");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(routeSearch.open ?? null);

  useEffect(() => {
    if (routeSearch.open) setOpenId(routeSearch.open);
  }, [routeSearch.open]);

  const query = useQuery({
    queryKey: ["customers-paged", debouncedQ, filter, page],
    queryFn: async () => {
      let custQuery = supabase
        .from("customers")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      const s = sanitizeSearch(debouncedQ);
      if (s) {
        custQuery = custQuery.or(`name.ilike.%${s}%,mobile.ilike.%${s}%`);
      }

      if (filter === "Due") {
        const { data: dueOrders, error: orderErr } = await supabase
          .from("orders")
          .select("customer_id, total_amount, advance_amount, discount_amount, order_status")
          .or(ACTIVE_ORDERS_FILTER)
          .neq("order_status", "Cancelled");
        if (orderErr) throw orderErr;

        const dueCustIds = [
          ...new Set(
            (dueOrders ?? [])
              .filter((o) => dueOf(o as any) > 0)
              .map((o) => o.customer_id)
          ),
        ];

        if (dueCustIds.length === 0) {
          return { rows: [] as Row[], total: 0 };
        }

        custQuery = custQuery.in("id", dueCustIds);
      }

      custQuery = custQuery.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      const { data: customers, count, error } = await custQuery;
      if (error) throw error;

      const custIds = (customers ?? []).map((c) => c.id);
      if (!custIds.length) {
        return { rows: [] as Row[], total: count ?? 0 };
      }

      const { data: orders } = await supabase
        .from("orders")
        .select("*")
        .or(ACTIVE_ORDERS_FILTER)
        .in("customer_id", custIds)
        .order("created_at", { ascending: false });

      const byCust: Record<string, Order[]> = {};
      (orders ?? []).forEach((o) => {
        (byCust[o.customer_id] ??= []).push(o as Order);
      });

      let rows = (customers ?? []).map((c) => {
        const list = byCust[c.id] ?? [];
        return {
          ...(c as Customer),
          last_order: list[0] ?? null,
          order_count: list.length,
          total_due: list.reduce((s, o) => s + dueOf(o), 0),
        } as Row;
      });

      if (filter !== "All" && filter !== "Due") {
        rows = rows.filter((r) => {
          const status = r.last_order?.order_status;
          if (!status) return false;
          if (filter === "Ongoing") return ONGOING_STATUSES.includes(status);
          return status === filter;
        });
      }

      if (filter === "Due") {
        rows = [...rows].sort((a, b) => b.total_due - a.total_due);
      }

      return { rows, total: count ?? 0 };
    },
  });

  const total = query.data?.total ?? 0;
  const paged = query.data?.rows ?? [];

  useEffect(() => setPage(1), [debouncedQ, filter]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by name or mobile" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {(["All", "Ongoing", "Completed", "Cancelled", "Due"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap min-h-[36px] ${
              filter === s
                ? s === "Due"
                  ? "bg-red-600 text-white border-transparent font-medium"
                  : "gold-gradient border-transparent font-medium"
                : "bg-white border-gold-100 hover:border-gold-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-white border border-gold-100 animate-pulse" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="bg-white rounded-xl border border-gold-100">
          <EmptyState icon={<Users className="w-10 h-10" />} title="No customers found" />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paged.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="w-full flex items-center gap-3 bg-white border border-gold-100 rounded-lg p-3 hover:shadow-[var(--shadow-card)] text-left"
              >
                <div className="w-10 h-10 rounded-full gold-gradient flex items-center justify-center font-bold shrink-0">
                  {c.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.mobile}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground">{c.order_count} orders</div>
                  {c.last_order && (
                    <div className="text-xs text-muted-foreground">Last: {fmtDate(c.last_order.order_date)}</div>
                  )}
                  {c.total_due > 0 && <div className="text-xs text-red-600 font-medium">Due {fmtAED(c.total_due)}</div>}
                </div>
              </button>
            ))}
          </div>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <CustomerDetail
        customerId={openId}
        open={!!openId}
        onOpenChange={(v) => { if (!v) setOpenId(null); }}
      />
    </div>
  );
}

function CustomerDetail({
  customerId, open, onOpenChange,
}: { customerId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [orderAgain, setOrderAgain] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [eName, setEName] = useState("");
  const [eMobile, setEMobile] = useState("");
  const [eAddress, setEAddress] = useState("");
  const [savingCust, setSavingCust] = useState(false);
  const detail = useQuery({
    queryKey: ["customer-detail", customerId],
    enabled: !!customerId && open,
    queryFn: async () => {
      const { data: c } = await supabase.from("customers").select("*").eq("id", customerId!).single();
      const { data: orders } = await supabase.from("orders").select("*").or(ACTIVE_ORDERS_FILTER).eq("customer_id", customerId!).order("order_date", { ascending: true });
      const orderIds = (orders ?? []).map((o) => o.id);
      const { data: payments } = orderIds.length
        ? await supabase.from("payments").select("*").in("order_id", orderIds).order("payment_date", { ascending: false })
        : { data: [] as Payment[] };
      const { data: history } = orderIds.length
        ? await supabase.from("order_status_history").select("*").in("order_id", orderIds).order("changed_at", { ascending: true })
        : { data: [] as OrderStatusHistory[] };
      const paymentsByOrder: Record<string, Payment[]> = {};
      (payments ?? []).forEach((p) => { (paymentsByOrder[p.order_id] ??= []).push(p as Payment); });
      const historyByOrder: Record<string, OrderStatusHistory[]> = {};
      (history ?? []).forEach((h) => { (historyByOrder[h.order_id] ??= []).push(h as OrderStatusHistory); });
      return { customer: c as Customer, orders: (orders ?? []) as Order[], paymentsByOrder, historyByOrder };
    },
  });

  const data = detail.data;
  const totalPaid = (data?.orders ?? []).reduce(
    (s, o) => s + (o.order_status === "Cancelled" ? 0 : Number(o.advance_amount)),
    0,
  );
  const totalDue = (data?.orders ?? []).reduce((s, o) => s + dueOf(o), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle className="text-gold-900">Customer Details</SheetTitle></SheetHeader>
        {!data ? (
          <div className="py-10 text-center text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-5 pt-2">
            <div className="rounded-xl p-5 text-white sidebar-gradient relative">
              {!editingCustomer ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEName(data.customer.name);
                      setEMobile(data.customer.mobile);
                      setEAddress(data.customer.address ?? "");
                      setEditingCustomer(true);
                    }}
                    className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md border border-white/40 bg-white/10 hover:bg-white/20 px-2 py-1 text-xs text-white"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                  <div className="flex items-center gap-3 mb-4 pr-16">
                    <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-xl font-bold">
                      {data.customer.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-lg font-semibold">{data.customer.name}</div>
                      <div className="text-sm opacity-80">{data.customer.mobile}</div>
                      {data.customer.address && <div className="text-xs opacity-70">{data.customer.address}</div>}
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-2 mb-4">
                  <div>
                    <Label className="text-xs text-white/80">Customer Name *</Label>
                    <Input value={eName} onChange={(e) => setEName(e.target.value)} className="bg-white text-foreground" />
                  </div>
                  <div>
                    <Label className="text-xs text-white/80">Mobile Number *</Label>
                    <Input value={eMobile} onChange={(e) => setEMobile(e.target.value)} className="bg-white text-foreground" />
                  </div>
                  <div>
                    <Label className="text-xs text-white/80">Address</Label>
                    <Input value={eAddress} onChange={(e) => setEAddress(e.target.value)} className="bg-white text-foreground" />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingCustomer(false)}
                      className="bg-transparent border-white/50 text-white hover:bg-white/10 hover:text-white"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingCust}
                      className="gold-gradient"
                      onClick={async () => {
                        if (!eName.trim() || !eMobile.trim()) return toast.error("Name and mobile are required");
                        setSavingCust(true);
                        const { error } = await supabase
                          .from("customers")
                          .update({ name: eName.trim(), mobile: eMobile.trim(), address: eAddress.trim() || null })
                          .eq("id", data.customer.id);
                        setSavingCust(false);
                        if (error) return toast.error(error.message);
                        toast.success("Customer updated");
                        setEditingCustomer(false);
                        qc.invalidateQueries({ queryKey: ["customers-paged"] });
                        qc.invalidateQueries({ queryKey: ["customer-detail", data.customer.id] });
                      }}
                    >
                      {savingCust ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-white/10 rounded-md p-2 text-center">
                  <div className="text-xs opacity-80">Total Orders</div>
                  <div className="font-bold">{data.orders.length}</div>
                </div>
                <div className="bg-white/10 rounded-md p-2 text-center">
                  <div className="text-xs opacity-80">Total Paid</div>
                  <div className="font-bold text-xs">{fmtAED(totalPaid)}</div>
                </div>
                <div className="bg-white/10 rounded-md p-2 text-center">
                  <div className="text-xs opacity-80">Total Due</div>
                  <div className="font-bold text-xs">{fmtAED(totalDue)}</div>
                </div>
              </div>
            </div>

            {data.orders.map((o, i) => {
              const due = dueOf(o);
              const pays = data.paymentsByOrder[o.id] ?? [];
              const hist = data.historyByOrder[o.id] ?? [];
              return (
                <div key={o.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gold-900">Order #{i + 1} — {fmtDate(o.order_date)}</div>
                    <OrderStatusBadge status={o.order_status} />
                  </div>
                  <RoomsDisplay
                    rooms={o.rooms}
                    additionalInfo={o.additional_info}
                    legacyDetails={o.order_details}
                  />
                  {o.delivery_date && <div className="text-xs text-muted-foreground">Delivery: {fmtDate(o.delivery_date)}</div>}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded border border-blue-200 bg-blue-50 p-2 text-blue-700"><div>TOTAL</div><b>{fmtAED(o.total_amount)}</b></div>
                    <div className="rounded border border-green-200 bg-green-50 p-2 text-green-700"><div>PAID</div><b>{fmtAED(o.advance_amount)}</b></div>
                    <div className={`rounded border p-2 ${due > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                      <div>DUE</div><b>{fmtAED(due)}</b>
                    </div>
                  </div>
                  {pays.length > 0 && (
                    <div className="text-xs divide-y divide-gold-100 border border-gold-100 rounded-md">
                      {pays.map((p) => {
                        const isRefund = p.payment_type === "refund";
                        return (
                          <div key={p.id} className="flex items-center justify-between px-2 py-1.5 gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {isRefund
                                ? <ArrowUpRight className="w-4 h-4 text-red-600 shrink-0" />
                                : <ArrowDownLeft className="w-4 h-4 text-green-600 shrink-0" />}
                              <span className="truncate">
                                {fmtDate(p.payment_date)} · {p.note || "—"}
                              </span>
                              {isRefund && (
                                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 text-red-700 px-1.5 py-0.5 text-[10px] font-medium shrink-0">
                                  Refund
                                </span>
                              )}
                            </div>
                            <span className={`font-medium shrink-0 ${isRefund ? "text-red-600" : "text-green-600"}`}>
                              {isRefund ? "− " : "+ "}{fmtAED(p.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className={`text-xs font-medium ${due > 0 ? "text-red-600" : isOngoing(o.order_status) ? "text-amber-600" : "text-green-600"}`}>
                    {due > 0 ? `⚠️ Still Due: ${fmtAED(due)}` : "✅ Fully Paid"}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <GitBranch className="w-3.5 h-3.5 text-gold-600" />
                      <div className="text-xs font-medium text-gold-800">Order Timeline</div>
                    </div>
                    {hist.length === 0 ? (
                      <div className="text-xs italic text-muted-foreground">No timeline data</div>
                    ) : (
                      <ol className="relative border-l border-gold-300 ml-2 space-y-2 pl-3">
                        {hist.map((h, idx) => {
                          const last = idx === hist.length - 1;
                          return (
                            <li key={h.id} className="relative">
                              <span className={`absolute -left-[16px] top-1 w-2.5 h-2.5 rounded-full border-2 ${last ? "bg-gold-500 border-gold-500" : "bg-white border-gold-400"}`} />
                              <div className="flex items-center gap-2 flex-wrap">
                                <OrderStatusBadge status={h.status} />
                                <span className="text-[11px] text-muted-foreground">{fmtDateTime(h.changed_at)}</span>
                              </div>
                              {h.note && <div className="text-[11px] italic text-muted-foreground mt-0.5">{h.note}</div>}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                  <div className="border-t border-dashed border-gold-200 pt-2" />

                </div>
              );
            })}

            {totalDue > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-red-700 font-semibold text-center">
                TOTAL OUTSTANDING DUE: {fmtAED(totalDue)}
              </div>
            )}

            {!orderAgain ? (
              <Button onClick={() => setOrderAgain(true)} className="w-full gold-gradient">Order Again</Button>
            ) : (
              <div className="border-t border-gold-100 pt-4">
                <OrderForm
                  mode={{ kind: "existing-customer", customer: data.customer }}
                  onDone={() => setOrderAgain(false)}
                  onCancel={() => setOrderAgain(false)}
                />
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
