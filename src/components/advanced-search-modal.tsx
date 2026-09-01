import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase, type Customer, type Order, ACTIVE_ORDERS_FILTER } from "@/lib/supabase";
import { fmtAED, fmtDate, dueOf, displayPaymentStatus } from "@/lib/format";
import { OrderStatusBadge, PaymentStatusBadge } from "./status-badges";

export function AdvancedSearchModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<"order" | "customer">("order");
  const [orderId, setOrderId] = useState("");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const orderQ = useQuery({
    queryKey: ["adv-order", orderId],
    enabled: false,
    queryFn: async () => {
      const { data } = await supabase.from("orders").select("*, customers(*)").or(ACTIVE_ORDERS_FILTER).eq("id", orderId).maybeSingle();
      return data as Order | null;
    },
  });

  const custQ = useQuery({
    queryKey: ["adv-cust", q],
    enabled: tab === "customer" && q.trim().length >= 2,
    queryFn: async () => {
      const s = q.trim();
      const { data } = await supabase
        .from("customers")
        .select("*")
        .or(`name.ilike.%${s}%,mobile.ilike.%${s}%`)
        .limit(20);
      return (data ?? []) as Customer[];
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Advanced Search</DialogTitle></DialogHeader>
        <div className="flex gap-2 rounded-lg bg-gold-50 p-1 mb-3">
          <button
            onClick={() => setTab("order")}
            className={`flex-1 py-1.5 text-sm rounded-md ${tab === "order" ? "bg-white shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            Search Order
          </button>
          <button
            onClick={() => setTab("customer")}
            className={`flex-1 py-1.5 text-sm rounded-md ${tab === "customer" ? "bg-white shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            Search Customer
          </button>
        </div>

        {tab === "order" ? (
          <div className="space-y-3">
            <Input
              placeholder="Enter Order ID (e.g. 040720261001)"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
            <Button onClick={() => orderQ.refetch()} disabled={!orderId} className="w-full gold-gradient">
              Search
            </Button>
            {orderQ.data && (
              <button
                onClick={() => {
                  onOpenChange(false);
                  navigate({ to: "/orders", search: { open: orderQ.data!.id } as any });
                }}
                className="w-full text-left border border-gold-100 rounded-md p-3 hover:bg-gold-50"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">{orderQ.data.customers?.name}</div>
                  <div className="font-semibold">{fmtAED(orderQ.data.total_amount)}</div>
                </div>
                <div className="text-xs text-muted-foreground mb-2">{fmtDate(orderQ.data.order_date)}</div>
                <div className="flex gap-2">
                  <OrderStatusBadge status={orderQ.data.order_status} />
                  <PaymentStatusBadge status={displayPaymentStatus(orderQ.data)} />
                </div>
              </button>
            )}
            {orderQ.isFetched && !orderQ.data && (
              <div className="text-sm text-muted-foreground text-center py-4">No order found.</div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Search by name or mobile number..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(custQ.data ?? []).map((c) => (
                <CustomerResultRow
                  key={c.id}
                  customer={c}
                  onPick={() => {
                    onOpenChange(false);
                    navigate({ to: "/customers", search: { open: c.id } as any });
                  }}
                />
              ))}
              {q.trim().length >= 2 && custQ.isFetched && (custQ.data?.length ?? 0) === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">No customers found.</div>
              )}
              {q.trim().length > 0 && q.trim().length < 2 && (
                <div className="text-xs text-muted-foreground text-center py-2">Type at least 2 characters…</div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerResultRow({ customer, onPick }: { customer: Customer; onPick: () => void }) {
  const { data } = useQuery({
    queryKey: ["cust-summary", customer.id],
    queryFn: async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("total_amount, advance_amount, discount_amount, order_status")
        .or(ACTIVE_ORDERS_FILTER)
        .eq("customer_id", customer.id);
      const count = orders?.length ?? 0;
      const totalDue = (orders ?? []).reduce((s, o: any) => s + dueOf(o), 0);
      return { count, totalDue };
    },
  });
  return (
    <button onClick={onPick} className="w-full text-left border border-gold-100 rounded-md p-3 hover:bg-gold-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{customer.name}</div>
          <div className="text-xs text-muted-foreground">{customer.mobile}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">{data?.count ?? 0} orders</div>
          {(data?.totalDue ?? 0) > 0 && <div className="text-xs text-red-600 font-medium">Due {fmtAED(data!.totalDue)}</div>}
        </div>
      </div>
    </button>
  );
}
