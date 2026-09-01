import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase, logActivity, type Customer, type Order, type OrderStatus, type PaymentStatus, type OrderRoom } from "@/lib/supabase";
import { computePaymentStatus, dueOf } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RoomsEditor } from "@/components/rooms-editor";
import { DatePickerField } from "@/components/date-picker-field";

export type OrderFormMode =
  | { kind: "new-customer" }
  | { kind: "existing-customer"; customer: Customer }
  | { kind: "edit"; order: Order };

export function OrderForm({
  mode,
  onDone,
  onCancel,
}: {
  mode: OrderFormMode;
  onDone?: (orderId: string) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const editing = mode.kind === "edit";
  const initialOrder = mode.kind === "edit" ? mode.order : null;
  const lockedCustomer =
    mode.kind === "existing-customer"
      ? mode.customer
      : mode.kind === "edit"
      ? mode.order.customers ?? null
      : null;

  const today = new Date().toISOString().slice(0, 10);
  const [orderId, setOrderId] = useState<string>(initialOrder?.id ?? "");
  const [name, setName] = useState(lockedCustomer?.name ?? "");
  const [mobile, setMobile] = useState(lockedCustomer?.mobile ?? "");
  const [address, setAddress] = useState(lockedCustomer?.address ?? "");
  const [rooms, setRooms] = useState<OrderRoom[]>(
    (initialOrder?.rooms as OrderRoom[] | null) ?? [],
  );
  const [additionalInfo, setAdditionalInfo] = useState<string>(initialOrder?.additional_info ?? "");
  const legacyDetails = initialOrder?.order_details ?? "";
  const [orderDate, setOrderDate] = useState(initialOrder?.order_date ?? today);
  const [deliveryDate, setDeliveryDate] = useState(initialOrder?.delivery_date ?? "");
  const [total, setTotal] = useState<string>(initialOrder ? String(initialOrder.total_amount) : "");
  const [discount, setDiscount] = useState<string>(initialOrder ? String(initialOrder.discount_amount ?? 0) : "0");
  const [advance, setAdvance] = useState<string>(initialOrder ? String(initialOrder.advance_amount) : "0");
  const [salesman, setSalesman] = useState(initialOrder?.salesman_name ?? "");
  const [fixingMan, setFixingMan] = useState(initialOrder?.fixing_man_name ?? "");
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(initialOrder?.order_status ?? "New Order");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(initialOrder?.payment_status ?? "Unpaid");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("generate_order_id", { p_date: orderDate });
      if (!cancelled && !error && data) setOrderId(data as string);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderDate, editing]);

  useEffect(() => {
    setPaymentStatus(computePaymentStatus(Number(total) || 0, Number(advance) || 0, Number(discount) || 0));
  }, [total, advance, discount]);

  const due = dueOf({
    total_amount: Number(total) || 0,
    advance_amount: Number(advance) || 0,
    discount_amount: Number(discount) || 0,
    order_status: orderStatus,
  });

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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    const hasEmptyRoom = rooms.some((r) => !r.name?.trim());
    if (hasEmptyRoom) return toast.error("Room name required");

    const hasEmptyWindow = rooms.some((r) =>
      r.windows?.some((w) => {
        const hasAny = Boolean(w.wname?.trim() || w.size?.trim() || w.style?.trim() || w.fabric?.trim() || w.note?.trim());
        const hasAll = Boolean(w.wname?.trim() && w.size?.trim());
        return hasAny && !hasAll; // partially filled
      })
    );
    if (hasEmptyWindow) return toast.error("Fill window name and size or remove empty window rows");

    const cleanedRooms = rooms
      .map((r) => ({
        ...r,
        name: r.name.trim(),
        windows: (r.windows || []).filter((w) => Boolean(w.wname?.trim() || w.size?.trim())),
      }))
      .filter((r) => r.windows.length > 0);

    if (cleanedRooms.length === 0 && !additionalInfo.trim() && !legacyDetails.trim()) {
      return toast.error("Please add at least one room or additional info");
    }

    const t = Number(total) || 0;
    try {
      let customerId = lockedCustomer?.id ?? "";
      if (mode.kind === "new-customer") {
        if (!name.trim() || !mobile.trim()) throw new Error("Name and mobile are required");
        const { data: cust, error: cErr } = await supabase
          .from("customers")
          .insert({ name: name.trim(), mobile: mobile.trim(), address: address.trim() || null })
          .select()
          .single();
        if (cErr) throw cErr;
        customerId = cust.id;
      }

      const payload = {
        order_details: editing ? legacyDetails : "",
        rooms: cleanedRooms,
        additional_info: additionalInfo || null,
        order_date: orderDate,
        delivery_date: deliveryDate || null,
        total_amount: Number(total),
        discount_amount: Number(discount) || 0,
        advance_amount: Number(advance) || 0,
        salesman_name: salesman || null,
        fixing_man_name: fixingMan || null,
        order_status: orderStatus,
        payment_status: paymentStatus,
      };

      if (editing && initialOrder) {
        const { error } = await supabase.from("orders").update(payload).eq("id", initialOrder.id);
        if (error) throw error;
        toast.success("Order updated");
        await logActivity("order_edited", "Order edited", initialOrder.id, `Order details updated`);
        onDone?.(initialOrder.id);
      } else {
        let id = orderId;
        if (!id) {
          const { data: newId } = await supabase.rpc("generate_order_id", { p_date: orderDate });
          id = newId as string;
        }
        const { error } = await supabase.from("orders").insert({
          id,
          customer_id: customerId,
          ...payload,
          advance_amount: 0,
          payment_status: "Unpaid",
        });
        if (error) throw error;
        // seed timeline
        await supabase.from("order_status_history").insert({
          order_id: id,
          status: orderStatus,
          note: "Order created",
        });
        if (Number(advance) > 0) {
          let atomicSuccess = false;
          try {
            const { error: rpcErr } = await supabase.rpc("add_payment_atomic", {
              p_order_id: id,
              p_amount: Number(advance),
              p_date: orderDate,
              p_type: "payment",
              p_note: "Initial advance",
            });
            if (!rpcErr) {
              atomicSuccess = true;
            }
          } catch {
            // RPC function may not exist yet, fallback below
          }

          if (!atomicSuccess) {
            // Fallback: non-atomic payment insert + order update
            await supabase.from("payments").insert({
              order_id: id,
              amount: Number(advance),
              payment_date: orderDate,
              payment_type: "payment",
              note: "Initial advance",
            });
            await supabase.from("orders").update({
              advance_amount: Number(advance),
              payment_status: paymentStatus,
            }).eq("id", id);
          }
        }
        toast.success("Order created");
        await logActivity(
          "order_created",
          "New order created",
          id,
          `Customer: ${name || lockedCustomer?.name || "existing"} · AED ${Number(total).toLocaleString()}`,
        );
        onDone?.(id);
      }
      qc.invalidateQueries();
    } catch (err: any) {
      toast.error(err.message || "Failed to save order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>Order ID</Label>
        <Input value={orderId} readOnly className="bg-gold-50 font-mono" placeholder="Auto-generated" />
      </div>

      {mode.kind === "new-customer" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Customer Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label>Mobile Number *</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} required />
          </div>
          <div className="md:col-span-2">
            <Label>Address</Label>
            <Input value={address ?? ""} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
      )}

      {lockedCustomer && (
        <div className="rounded-md border border-gold-100 bg-gold-50 p-3 text-sm">
          <div className="font-medium text-gold-900">{lockedCustomer.name}</div>
          <div className="text-muted-foreground">
            {lockedCustomer.mobile} {lockedCustomer.address ? `· ${lockedCustomer.address}` : ""}
          </div>
        </div>
      )}

      <RoomsEditor value={rooms} onChange={setRooms} />

      {legacyDetails.trim() && rooms.length === 0 && (
        <div>
          <Label className="text-xs">Legacy Details (read only)</Label>
          <pre className="whitespace-pre-wrap text-xs bg-gold-50 border border-gold-100 rounded-md p-2 font-sans">{legacyDetails}</pre>
        </div>
      )}

      <div>
        <Label>Additional Info</Label>
        <Textarea
          rows={3}
          value={additionalInfo}
          onChange={(e) => setAdditionalInfo(e.target.value)}
          placeholder="Any additional notes, special instructions, or extra details..."
        />
      </div>


      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Order Date *</Label>
          <DatePickerField value={orderDate} onChange={setOrderDate} />
        </div>
        <div>
          <Label>Est. Delivery Date</Label>
          <DatePickerField value={deliveryDate} onChange={setDeliveryDate} />
        </div>
        <div>
          <Label>Total Amount (AED) *</Label>
          <Input type="number" step="0.01" min="0" value={total} onChange={(e) => setTotal(e.target.value)} required />
        </div>
        <div>
          <Label>Discount (AED)</Label>
          <Input type="number" step="0.01" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </div>
        <div>
          <Label>Advance (AED)</Label>
          <Input type="number" step="0.01" min="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
        </div>
        <div>
          <Label>Due (AED)</Label>
          <Input value={due.toFixed(2)} readOnly className="bg-gold-50" />
        </div>
        <div>
          <Label>Payment Status</Label>
          <Input value={orderStatus === "Cancelled" ? "Cancelled" : paymentStatus} readOnly className="bg-gold-50" />
        </div>
        <div>
          <Label>Salesman Name</Label>
          <Input value={salesman ?? ""} onChange={(e) => setSalesman(e.target.value)} />
        </div>
        <div>
          <Label>Fixing Man Name</Label>
          <Input value={fixingMan ?? ""} onChange={(e) => setFixingMan(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label>Order Status</Label>
          <Select value={orderStatus} onValueChange={(v) => setOrderStatus(v as OrderStatus)}>
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
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="border-gold-300 text-gold-700 hover:bg-gold-50">
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy} className="gold-gradient hover:opacity-90">
          {busy ? "Saving…" : editing ? "Update Order" : "Save Order"}
        </Button>
      </div>
    </form>
  );
}
