import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  supabase, logActivity, type Order, type OrderStatus, type Payment, type PaymentType, type OrderStatusHistory,
} from "@/lib/supabase";
import {
  computePaymentStatus, dueOf, fmtAED, fmtDate, fmtDateTime, displayPaymentStatus, netOf,
} from "@/lib/format";
import { OrderStatusBadge, PaymentStatusBadge } from "./status-badges";
import { OrderForm } from "./order-form";
import { Plus, Pencil, Trash2, GitBranch } from "lucide-react";
import { RoomsDisplay } from "./rooms-editor";
import { DatePickerField } from "./date-picker-field";

export function OrderDetailSheet({
  orderId,
  open,
  onOpenChange,
}: {
  orderId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [addingPayment, setAddingPayment] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pType, setPType] = useState<PaymentType>("payment");
  const [amt, setAmt] = useState("");
  const [pdate, setPdate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [deleteOrderOpen, setDeleteOrderOpen] = useState(false);
  const [deletePayment, setDeletePayment] = useState<Payment | null>(null);

  const orderQ = useQuery({
    queryKey: ["order", orderId],
    enabled: !!orderId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(*)")
        .eq("id", orderId!)
        .single();
      if (error) throw error;
      return data as Order;
    },
  });

  const paymentsQ = useQuery({
    queryKey: ["payments", orderId],
    enabled: !!orderId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("order_id", orderId!)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });

  const historyQ = useQuery({
    queryKey: ["order-history", orderId],
    enabled: !!orderId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId!)
        .order("changed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OrderStatusHistory[];
    },
  });

  const order = orderQ.data;
  const payments = paymentsQ.data ?? [];
  const history = historyQ.data ?? [];
  const due = order ? dueOf(order) : 0;
  const net = order ? netOf(order) : 0;
  const hasDiscount = !!order && Number(order.discount_amount) > 0;

  const resetPaymentForm = () => {
    setAmt("");
    setNote("");
    setPType("payment");
    setAddingPayment(false);
  };

  /**
   * Supabase RPC function for atomic payments:
   * create or replace function public.add_payment_atomic(p_order_id text, p_amount numeric, p_date date, p_type text, p_note text default null)
   * returns void language plpgsql security definer as $$
   * declare cur_adv numeric; cur_total numeric; cur_disc numeric; new_adv numeric; net_amt numeric; new_status text;
   * begin
   *   select coalesce(advance_amount, 0), coalesce(total_amount, 0), coalesce(discount_amount, 0)
   *     into cur_adv, cur_total, cur_disc from orders where id=p_order_id for update;
   *   if not found then raise exception 'Order % not found', p_order_id; end if;
   *   if p_type='refund' then
   *     if p_amount > cur_adv then raise exception 'Refund exceeds paid'; end if;
   *     new_adv := cur_adv - p_amount;
   *   else
   *     new_adv := cur_adv + p_amount;
   *   end if;
   *   net_amt := greatest(0, cur_total - cur_disc);
   *   if new_adv <= 0 then new_status := 'Unpaid';
   *   elsif new_adv >= net_amt then new_status := 'Full Paid';
   *   else new_status := 'Partial Paid';
   *   end if;
   *   insert into payments(order_id, amount, payment_date, payment_type, note) values(p_order_id, p_amount, p_date, p_type, p_note);
   *   update orders set advance_amount=new_adv, payment_status=new_status, updated_at=now() where id=p_order_id;
   * end; $$;
   */
  const addPayment = async () => {
    if (!order) return;
    const n = Number(amt);
    if (!amt || isNaN(n) || n <= 0) return toast.error("Enter a valid amount (> 0)");

    let newAdv: number;
    if (pType === "refund") {
      if (n > Number(order.advance_amount)) {
        return toast.error(`Refund amount cannot exceed total paid (${fmtAED(order.advance_amount)})`);
      }
      newAdv = Math.max(0, Number(order.advance_amount) - n);
    } else {
      const remainingDue = dueOf(order);
      if (n > remainingDue) {
        return toast.error(`Payment cannot exceed remaining due (${fmtAED(remainingDue)})`);
      }
      newAdv = Number(order.advance_amount) + n;
    }

    const status = computePaymentStatus(order.total_amount, newAdv, order.discount_amount);
    let atomicSuccess = false;

    try {
      const { error: rpcErr } = await supabase.rpc("add_payment_atomic", {
        p_order_id: order.id,
        p_amount: n,
        p_date: pdate,
        p_type: pType,
        p_note: note || null,
      });
      if (!rpcErr) {
        atomicSuccess = true;
      } else if (rpcErr.message?.includes("Refund exceeds") || rpcErr.code === "P0001") {
        return toast.error(rpcErr.message);
      }
    } catch {
      // Fallback below if RPC does not exist
    }

    if (!atomicSuccess) {
      const { error: pErr } = await supabase.from("payments").insert({
        order_id: order.id,
        amount: n,
        payment_date: pdate,
        payment_type: pType,
        note: note || null,
      });
      if (pErr) return toast.error(pErr.message);
      const { error: oErr } = await supabase
        .from("orders")
        .update({ advance_amount: newAdv, payment_status: status })
        .eq("id", order.id);
      if (oErr) return toast.error(oErr.message);
    }

    toast.success(pType === "refund" ? "Refund recorded" : "Payment added");
    await logActivity(
      "payment_added",
      pType === "refund" ? "Refund issued" : "Payment received",
      order.id,
      `${fmtAED(n)} · ${pType === "refund" ? "Refund" : "Payment recorded"}`,
    );
    resetPaymentForm();
    qc.invalidateQueries();
  };

  const changeOrderStatus = async (v: OrderStatus) => {
    if (!order || v === order.order_status) return;
    const { error } = await supabase.from("orders").update({ order_status: v }).eq("id", order.id);
    if (error) return toast.error(error.message);
    await supabase.from("order_status_history").insert({
      order_id: order.id,
      status: v,
    });
    toast.success(`Order status updated to ${v}`);
    await logActivity("status_changed", "Order status updated", order.id, `${order.order_status} → ${v}`);
    qc.invalidateQueries();
  };

  const doDeleteOrder = async () => {
    if (!order) return;
    const { error } = await supabase
      .from("orders")
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success("Order moved to Recycle Bin");
    await logActivity("order_deleted", "Order moved to Recycle Bin", order.id, `Order deleted by admin`);
    setDeleteOrderOpen(false);
    onOpenChange(false);
    qc.invalidateQueries();
  };

  const doDeletePayment = async () => {
    if (!order || !deletePayment) return;
    const p = deletePayment;
    const delta = Number(p.amount);
    const newAdv = p.payment_type === "payment"
      ? Math.max(0, Number(order.advance_amount) - delta)
      : Number(order.advance_amount) + delta;
    const status = computePaymentStatus(order.total_amount, newAdv, order.discount_amount);

    const { error: dErr } = await supabase.from("payments").delete().eq("id", p.id);
    if (dErr) return toast.error(dErr.message);
    const { error: uErr } = await supabase
      .from("orders")
      .update({ advance_amount: newAdv, payment_status: status })
      .eq("id", order.id);
    if (uErr) return toast.error(uErr.message);
    toast.success("Payment record removed");
    await logActivity("payment_deleted", "Payment record removed", order.id, `${fmtAED(Number(p.amount))} entry deleted`);
    setDeletePayment(null);
    qc.invalidateQueries();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-gold-900">Order Details</SheetTitle>
          </SheetHeader>
          {orderQ.isLoading || !order ? (
            <div className="py-10 text-center text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-5 pt-2">
              <div className="rounded-lg border border-gold-100 p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-gold-900">{order.customers?.name}</div>
                    <div className="text-sm text-muted-foreground">{order.customers?.mobile}</div>
                    {order.customers?.address && (
                      <div className="text-xs text-muted-foreground">{order.customers.address}</div>
                    )}
                    <div className="text-xs mt-1 font-mono text-muted-foreground">#{order.id}</div>
                  </div>
                  <OrderStatusBadge status={order.order_status} />
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                  <div><div className="text-xs text-muted-foreground">Order Date</div><div>{fmtDate(order.order_date)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Est. Delivery Date</div><div>{fmtDate(order.delivery_date)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Salesman</div><div>{order.salesman_name || "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Fixing Man</div><div>{order.fixing_man_name || "—"}</div></div>
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Order Details</div>
                <RoomsDisplay
                  rooms={order.rooms}
                  additionalInfo={order.additional_info}
                  legacyDetails={order.order_details}
                />
              </div>


              {hasDiscount ? (
                <div className="grid grid-cols-2 gap-2">
                  <StatBox label="TOTAL BILL" value={fmtAED(order.total_amount)} tone="blue" />
                  <StatBox label="DISCOUNT" value={fmtAED(order.discount_amount)} tone="gold" />
                  <StatBox label="NET" value={fmtAED(net)} tone="blue" />
                  <StatBox label="TOTAL PAID" value={fmtAED(order.advance_amount)} tone="green" />
                  <StatBox
                    label="DUE"
                    value={fmtAED(due)}
                    tone={due > 0 ? "red" : "green"}
                    className="col-span-2"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <StatBox label="TOTAL BILL" value={fmtAED(order.total_amount)} tone="blue" />
                  <StatBox label="TOTAL PAID" value={fmtAED(order.advance_amount)} tone="green" />
                  <StatBox label="DUE" value={fmtAED(due)} tone={due > 0 ? "red" : "green"} />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-gold-900">Payment History</div>
                  <Button size="sm" variant="outline" onClick={() => setAddingPayment((v) => !v)}>
                    <Plus className="w-4 h-4" /> Add Payment
                  </Button>
                </div>
                {addingPayment && (
                  <div className="rounded-md border border-gold-200 bg-gold-50 p-3 mb-2 space-y-2">
                    <div className="flex gap-2 rounded-lg bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setPType("payment")}
                        className={`flex-1 py-1.5 text-sm rounded-md ${pType === "payment" ? "gold-gradient font-medium" : "text-muted-foreground"}`}
                      >
                        Payment
                      </button>
                      <button
                        type="button"
                        onClick={() => setPType("refund")}
                        className={`flex-1 py-1.5 text-sm rounded-md ${pType === "refund" ? "bg-red-500 text-white font-medium" : "text-muted-foreground"}`}
                      >
                        Refund
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">
                          {pType === "refund" ? "Refund Amount (AED)" : "Amount Received (AED)"}
                        </Label>
                        <Input type="number" min="0" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">{pType === "refund" ? "Refund Date" : "Payment Date"}</Label>
                        <DatePickerField value={pdate} onChange={setPdate} />
                      </div>
                    </div>
                    {pType === "refund" && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
                        ⚠️ This will reduce the total paid amount.
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">Note (optional)</Label>
                      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Cash / Bank transfer" />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={resetPaymentForm}>Cancel</Button>
                      <Button size="sm" onClick={addPayment} className={pType === "refund" ? "bg-red-600 hover:bg-red-700 text-white" : "gold-gradient"}>
                        {pType === "refund" ? "Save Refund" : "Save Payment"}
                      </Button>
                    </div>
                  </div>
                )}
                {payments.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-2">No payments recorded yet.</div>
                ) : (
                  <div className="divide-y divide-gold-100 border border-gold-100 rounded-md">
                    {payments.map((p) => {
                      const isRefund = p.payment_type === "refund";
                      return (
                        <div key={p.id} className="group flex items-center justify-between px-3 py-2 text-sm gap-2">
                          <div className="min-w-0">
                            <div>{fmtDate(p.payment_date)}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              {p.note || "—"}
                              {isRefund && (
                                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 text-red-700 px-1.5 py-0.5 text-[10px] font-medium">
                                  Refund
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div className={`font-semibold ${isRefund ? "text-red-600" : "text-green-600"}`}>
                              {isRefund ? "−" : "+"}{fmtAED(p.amount)}
                            </div>
                            <button
                              type="button"
                              onClick={() => setDeletePayment(p)}
                              className="p-1 rounded hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                              aria-label="Delete payment"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <GitBranch className="w-4 h-4 text-gold-600" />
                  <div className="font-medium text-gold-900">Order Timeline</div>
                </div>
                {history.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No timeline entries yet.</div>
                ) : (
                  <ol className="relative border-l border-gold-300 ml-2 space-y-4 pl-4">
                    {history.map((h, i) => {
                      const isLast = i === history.length - 1;
                      return (
                        <li key={h.id} className="relative">
                          <span
                            className={`absolute -left-[22px] top-1 w-3 h-3 rounded-full border-2 ${
                              isLast ? "bg-gold-500 border-gold-500" : "bg-white border-gold-400"
                            }`}
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <OrderStatusBadge status={h.status} />
                            <span className="text-xs text-muted-foreground">{fmtDateTime(h.changed_at)}</span>
                          </div>
                          {h.note && <div className="text-xs text-muted-foreground mt-0.5">{h.note}</div>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-gold-100">
                <div className="flex-1">
                  <Label className="text-xs">Order Status</Label>
                  <Select value={order.order_status} onValueChange={(v) => changeOrderStatus(v as OrderStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="New Order">New Order</SelectItem>
                      <SelectItem value="Measurement Complete">Measurement Complete</SelectItem>
                      <SelectItem value="In Process">In Process</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-4">
                  <PaymentStatusBadge status={displayPaymentStatus(order)} />
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
                <Pencil className="w-4 h-4" /> Edit Order
              </Button>
              <Button
                variant="outline"
                className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => setDeleteOrderOpen(true)}
              >
                <Trash2 className="w-4 h-4" /> Delete Order
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Order</DialogTitle></DialogHeader>
          {order && <OrderForm mode={{ kind: "edit", order }} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOrderOpen} onOpenChange={setDeleteOrderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription>
              Move order #{order?.id} to Recycle Bin? You can restore it later from Recycle Bin. Payments will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDeleteOrder}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Move to Recycle Bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletePayment} onOpenChange={(v) => !v && setDeletePayment(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletePayment && (
                <>
                  Remove {deletePayment.payment_type} of {fmtAED(deletePayment.amount)} on{" "}
                  {fmtDate(deletePayment.payment_date)}? This will also update the order's paid amount.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDeletePayment} className="bg-red-600 hover:bg-red-700 text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatBox({
  label, value, tone, className,
}: { label: string; value: string; tone: "blue" | "green" | "red" | "gold"; className?: string }) {
  const map = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gold: "bg-gold-50 text-gold-800 border-gold-200",
  } as const;
  return (
    <div className={`rounded-lg border p-3 text-center ${map[tone]} ${className ?? ""}`}>
      <div className="text-[10px] font-medium opacity-80">{label}</div>
      <div className="text-sm font-bold mt-1">{value}</div>
    </div>
  );
}
