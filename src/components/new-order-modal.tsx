import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, type Customer } from "@/lib/supabase";
import { OrderForm } from "./order-form";
import { UserPlus, Users } from "lucide-react";

export function NewOrderModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const [step, setStep] = useState<"choose" | "new" | "existing">("choose");
  const [pickedCustomer, setPickedCustomer] = useState<Customer | null>(null);
  const [q, setQ] = useState("");

  const results = useQuery({
    queryKey: ["cust-search", q],
    enabled: step === "existing" && q.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .or(`name.ilike.%${q}%,mobile.ilike.%${q}%`)
        .limit(20);
      return (data ?? []) as Customer[];
    },
  });

  const reset = () => {
    setStep("choose");
    setPickedCustomer(null);
    setQ("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "choose"
              ? "New Order"
              : step === "new"
              ? "New Customer Order"
              : pickedCustomer
              ? `Order for ${pickedCustomer.name}`
              : "Choose Customer"}
          </DialogTitle>
        </DialogHeader>

        {step === "choose" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <button
              onClick={() => setStep("new")}
              className="rounded-xl border-2 border-gold-200 hover:border-gold-400 hover:bg-gold-50 p-6 text-left transition-colors"
            >
              <UserPlus className="w-8 h-8 text-gold-500 mb-3" />
              <div className="font-semibold text-gold-900">New Customer</div>
              <div className="text-sm text-muted-foreground mt-1">
                First-time customer — create customer + order together.
              </div>
            </button>
            <button
              onClick={() => setStep("existing")}
              className="rounded-xl border-2 border-gold-200 hover:border-gold-400 hover:bg-gold-50 p-6 text-left transition-colors"
            >
              <Users className="w-8 h-8 text-gold-500 mb-3" />
              <div className="font-semibold text-gold-900">Existing Customer</div>
              <div className="text-sm text-muted-foreground mt-1">
                Search by name or mobile and add a new order.
              </div>
            </button>
          </div>
        )}

        {step === "new" && (
          <OrderForm
            mode={{ kind: "new-customer" }}
            onDone={(id) => {
              onCreated?.(id);
              onOpenChange(false);
              reset();
            }}
          />
        )}

        {step === "existing" && !pickedCustomer && (
          <div className="space-y-3">
            <Input placeholder="Search by name or mobile…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(results.data ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPickedCustomer(c)}
                  className="w-full text-left border border-gold-100 rounded-md p-3 hover:bg-gold-50"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.mobile}</div>
                </button>
              ))}
              {q && (results.data?.length ?? 0) === 0 && !results.isLoading && (
                <div className="text-sm text-muted-foreground text-center py-4">No matching customers.</div>
              )}
            </div>
          </div>
        )}

        {step === "existing" && pickedCustomer && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPickedCustomer(null)}>← Change customer</Button>
            <OrderForm
              mode={{ kind: "existing-customer", customer: pickedCustomer }}
              onDone={(id) => {
                onCreated?.(id);
                onOpenChange(false);
                reset();
              }}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
