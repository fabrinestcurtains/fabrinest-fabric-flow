import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase, type Order } from "@/lib/supabase";
import { fmtAED, fmtDate, fmtDateTime } from "@/lib/format";
import { OrderStatusBadge } from "./status-badges";
import { EmptyState } from "./empty-state";
import { Pagination } from "./pagination";

const PAGE_SIZE = 10;

export function RecycleBinModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ["recycle-bin-orders"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(name, mobile)")
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Order[];
    },
  });

  const rows = q.data ?? [];
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const restore = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ is_deleted: false, deleted_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Order restored successfully");
    qc.invalidateQueries();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-500" /> Recycle Bin
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Deleted orders — can be restored</p>
        </DialogHeader>

        {q.isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Trash2 className="w-10 h-10" />} title="Recycle bin is empty" />
        ) : (
          <>
            <div className="space-y-2">
              {paged.map((o) => (
                <div
                  key={o.id}
                  className="border border-gold-100 rounded-lg p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gold-900 truncate">{o.customers?.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">#{o.id}</div>
                    <div className="text-xs text-muted-foreground">
                      Ordered: {fmtDate(o.order_date)}
                      {o.deleted_at && <> · Deleted: {fmtDateTime(o.deleted_at)}</>}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="opacity-60"><OrderStatusBadge status={o.order_status} /></span>
                      <span className="text-sm font-semibold text-gold-900">{fmtAED(o.total_amount)}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => restore(o.id)}
                    className="border-green-300 text-green-700 hover:bg-green-50"
                  >
                    <RotateCcw className="w-4 h-4" /> Restore
                  </Button>
                </div>
              ))}
            </div>
            <Pagination page={page} total={rows.length} pageSize={PAGE_SIZE} onChange={setPage} />
          </>
        )}
        <p className="text-xs italic text-muted-foreground text-center pt-2">
          Restored orders will reappear in Order History
        </p>
      </DialogContent>
    </Dialog>
  );
}
