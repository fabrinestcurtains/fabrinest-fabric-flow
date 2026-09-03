import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Search, Plus, ClipboardList, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, type Order, ACTIVE_ORDERS_FILTER, sanitizeSearch } from "@/lib/supabase";
import { fmtAED, fmtDate, dueOf, ONGOING_STATUSES } from "@/lib/format";
import { OrderStatusBadge, PaymentStatusBadge, statusBorderClass } from "@/components/status-badges";
import { Pagination } from "@/components/pagination";
import { EmptyState } from "@/components/empty-state";
import { NewOrderModal } from "@/components/new-order-modal";
import { OrderDetailSheet } from "@/components/order-detail-sheet";
import { RecycleBinModal } from "@/components/recycle-bin-modal";
import { useDebouncedValue } from "@/hooks/use-debounce";

type Filter = "All" | "Ongoing" | "Completed" | "Cancelled";

const search = z.object({
  status: z.enum(["All", "Ongoing", "Completed", "Cancelled"]).optional(),
  open: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/orders")({
  ssr: false,
  validateSearch: search,
  component: OrdersPage,
});

const PAGE_SIZE = 10;

function OrdersPage() {
  const routeSearch = useSearch({ from: "/_authenticated/orders" });
  const [filter, setFilter] = useState<Filter>(routeSearch.status ?? "All");
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(routeSearch.open ?? null);

  useEffect(() => {
    if (routeSearch.open) setOpenId(routeSearch.open);
  }, [routeSearch.open]);

  const orders = useQuery({
    queryKey: ["orders-list", filter, debouncedQ, page],
    queryFn: async () => {
      const s = sanitizeSearch(debouncedQ);
      let query;
      if (s) {
        query = supabase
          .from("orders")
          .select("*, customers!inner(*)", { count: "exact" })
          .or(ACTIVE_ORDERS_FILTER)
          .or(`id.ilike.%${s}%,customers.name.ilike.%${s}%,customers.mobile.ilike.%${s}%`);
      } else {
        query = supabase
          .from("orders")
          .select("*, customers(*)", { count: "exact" })
          .or(ACTIVE_ORDERS_FILTER);
      }

      if (filter === "Ongoing") {
        query = query.in("order_status", ONGOING_STATUSES);
      } else if (filter !== "All") {
        query = query.eq("order_status", filter);
      }

      query = query
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as Order[], total: count ?? 0 };
    },
  });

  const total = orders.data?.total ?? 0;
  const paged = orders.data?.rows ?? [];

  useEffect(() => setPage(1), [filter, debouncedQ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by order ID, customer name or mobile" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button className="gold-gradient" onClick={() => setNewOpen(true)}>
          <Plus className="w-4 h-4" /> New Order
        </Button>
        <div className="relative">
          <Button
            variant="outline"
            onClick={() => setBinOpen(true)}
            className="border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
          >
            <Trash2 className="w-4 h-4" /> Recycle Bin
          </Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {(["All", "Ongoing", "Completed", "Cancelled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap min-h-[36px] ${
              filter === s
                ? "gold-gradient border-transparent font-medium"
                : "bg-white border-gold-100 hover:border-gold-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        {orders.isLoading
          ? "Loading orders…"
          : `Showing ${paged.length} of ${orders.data?.total ?? 0} orders ${filter !== "All" ? `(${filter})` : ""} ${debouncedQ ? `for "${debouncedQ}"` : ""}`.trim()}
      </div>

      {orders.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-white border border-gold-100 animate-pulse" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="bg-white rounded-xl border border-gold-100">
          <EmptyState icon={<ClipboardList className="w-10 h-10" />} title="No orders" description="Create a new order to get started." />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paged.map((o) => {
              const due = dueOf(o);
              const hasDiscount = Number(o.discount_amount) > 0;
              return (
                <button
                  key={o.id}
                  onClick={() => setOpenId(o.id)}
                  className={`w-full text-left bg-white border border-gold-100 border-l-4 ${statusBorderClass(o.order_status)} rounded-lg p-4 hover:shadow-[var(--shadow-card)] transition-shadow`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-gold-900 truncate">{o.customers?.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">#{o.id}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(o.order_date)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-gold-900">{fmtAED(o.total_amount)}</div>
                      {hasDiscount && (
                        <div className="text-[11px] text-gold-600 font-medium">Discount: {fmtAED(o.discount_amount)}</div>
                      )}
                      <div className="flex gap-1 mt-1 justify-end flex-wrap">
                        <OrderStatusBadge status={o.order_status} />
                        <PaymentStatusBadge status={o.order_status === "Cancelled" ? "Cancelled" : o.payment_status} />
                      </div>
                      {due > 0 && <div className="text-xs text-red-600 mt-1 font-medium">Due {fmtAED(due)}</div>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <Pagination page={page} total={total} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      <NewOrderModal open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOpenId(id)} />
      <OrderDetailSheet
        orderId={openId}
        open={!!openId}
        onOpenChange={(v) => { if (!v) setOpenId(null); }}
      />
      <RecycleBinModal open={binOpen} onOpenChange={setBinOpen} />
    </div>
  );
}
