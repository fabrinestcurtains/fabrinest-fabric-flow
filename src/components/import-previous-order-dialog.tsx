import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw, Eye, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase, ACTIVE_ORDERS_FILTER, type Order } from "@/lib/supabase";
import { fmtAED, fmtDate } from "@/lib/format";
import { RoomsDisplay } from "@/components/rooms-editor";

interface ImportPreviousOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string | null;
  onImport: (order: Order) => void;
  prefetchedOrders?: Order[];
}

export function ImportPreviousOrderDialog({
  open,
  onOpenChange,
  customerId,
  onImport,
  prefetchedOrders,
}: ImportPreviousOrderDialogProps) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  const prevOrdersQ = useQuery({
    queryKey: ["prev-orders", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_date, total_amount, advance_amount, rooms, created_at, order_status")
        .eq("customer_id", customerId)
        .or(ACTIVE_ORDERS_FILTER)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data ?? []) as Order[];
    },
    enabled: !!customerId && open && !prefetchedOrders,
    initialData: prefetchedOrders,
  });

  const orders = prefetchedOrders ?? prevOrdersQ.data ?? [];
  const selectedOrder = orders.find((o) => o.id === selectedOrderId) || null;

  const handleImportOrder = (order: Order) => {
    onImport(order);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-4 sm:p-6 overflow-hidden">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-lg sm:text-xl font-bold text-gold-900 flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-gold-600" />
              Import from Previous Orders
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm text-muted-foreground">
              Select an order to copy its rooms &amp; windows. You can edit after import.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 py-2 space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-gold-100">
              <span className="text-xs font-semibold text-gold-900 uppercase tracking-wider">
                Recent Orders
              </span>
              <span className="text-xs text-muted-foreground">
                {orders.length} order{orders.length !== 1 ? "s" : ""} available
              </span>
            </div>

            {prevOrdersQ.isLoading && !orders.length ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-gold-100 rounded-xl p-4 space-y-2 bg-white"
                  >
                    <div className="flex justify-between items-center">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-5 w-24 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                    <div className="flex gap-2 pt-1">
                      <Skeleton className="h-8 w-28" />
                      <Skeleton className="h-8 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-10 px-4 bg-gold-50/50 rounded-xl border border-dashed border-gold-200">
                <Layers className="w-8 h-8 text-gold-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gold-900">No previous orders found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  This customer doesn't have any past orders to import rooms from.
                </p>
              </div>
            ) : (
              orders.map((order) => {
                const isSelected = selectedOrderId === order.id;
                const roomCount = order.rooms?.length || 0;

                const roomSummaryText =
                  order.rooms && order.rooms.length > 0
                    ? order.rooms
                        .map(
                          (r: any) =>
                            `${r.name || "Room"}: ${r.windows?.length || 0} Window(s) — ${(r.windows || [])
                              .map((w: any) => `${w.size || "—"}, ${w.style || "—"}`)
                              .join("; ")}`
                        )
                        .join("\n")
                    : "No room breakdown recorded in this order.";

                return (
                  <div
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className={`border rounded-xl p-3 sm:p-4 cursor-pointer transition-all ${
                      isSelected
                        ? "border-amber-700 bg-gold-50/80 ring-2 ring-gold-400 shadow-md"
                        : "border-gold-100 bg-white hover:border-gold-300 hover:bg-gold-50/40"
                    }`}
                  >
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <span className="font-bold text-sm text-gold-900">
                        #{order.id} — {fmtDate(order.order_date)}
                      </span>
                      <span className="text-xs bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        {order.order_status} · {roomCount} room{roomCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="text-xs text-muted-foreground mt-1">
                      Total <span className="font-medium text-foreground">{fmtAED(order.total_amount)}</span> · Paid{" "}
                      <span className="font-medium text-foreground">{fmtAED(order.advance_amount)}</span>
                    </div>

                    <div className="text-xs bg-gold-50/40 border border-gold-100 rounded-lg p-2.5 mt-2.5 max-h-[100px] overflow-y-auto font-sans whitespace-pre-line text-gold-950/90 leading-relaxed">
                      {roomSummaryText}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-3 pt-1">
                      <Button
                        size="sm"
                        className="gold-gradient h-8 sm:h-7 text-xs font-medium"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleImportOrder(order);
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" /> Import This Order
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 sm:h-7 text-xs text-gold-800 hover:bg-gold-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewOrder(order);
                        }}
                      >
                        <Eye className="w-3.5 h-3.5 mr-1" /> Preview
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-gold-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-gold-300 text-gold-700 hover:bg-gold-50 w-full sm:w-auto h-10 sm:h-9"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!selectedOrder || !selectedOrder.rooms?.length}
              onClick={() => selectedOrder && handleImportOrder(selectedOrder)}
              className="gold-gradient w-full sm:w-auto h-10 sm:h-9"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Import Selected ({selectedOrder?.rooms?.length || 0} rooms)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      {previewOrder && (
        <Dialog open={!!previewOrder} onOpenChange={(v) => !v && setPreviewOrder(null)}>
          <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-4 sm:p-6 overflow-hidden">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="text-lg font-bold text-gold-900">
                Order #{previewOrder.id} — Preview
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Date: {fmtDate(previewOrder.order_date)} · Status: {previewOrder.order_status} · Total:{" "}
                {fmtAED(previewOrder.total_amount)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-2 space-y-4 pr-1">
              <RoomsDisplay
                rooms={previewOrder.rooms}
                additionalInfo={previewOrder.additional_info}
                legacyDetails={previewOrder.order_details}
              />
            </div>

            <DialogFooter className="pt-2 border-t border-gold-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreviewOrder(null)}
                className="border-gold-300 text-gold-700 hover:bg-gold-50"
              >
                Close Preview
              </Button>
              <Button
                type="button"
                disabled={!previewOrder.rooms?.length}
                onClick={() => {
                  const toImport = previewOrder;
                  setPreviewOrder(null);
                  handleImportOrder(toImport);
                }}
                className="gold-gradient"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                Import This Order ({previewOrder.rooms?.length || 0} rooms)
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

