import { useState, useEffect } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/date-picker-field";
import {
  supabase,
  logActivity,
  generateExpenseCode,
  type Expense,
  EXPENSE_CATEGORIES,
} from "@/lib/supabase";
import { fmtAED, fmtDate } from "@/lib/format";

export interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Expense | null;
  onSuccess?: (saved: Expense) => void;
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  editing = null,
  onSuccess,
}: ExpenseFormDialogProps) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Others");
  const [othersText, setOthersText] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState<string | null>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(editing?.title ?? "");
      setAmount(editing ? String(editing.amount) : "");
      const cat = editing?.category ?? "Others";
      if (cat.startsWith("Others - ")) {
        setCategory("Others");
        setOthersText(cat.slice("Others - ".length));
      } else if (cat === "Miscellaneous") {
        setCategory("Others");
        setOthersText("");
      } else {
        setCategory(cat);
        setOthersText("");
      }
      setDate(editing?.expense_date ?? format(new Date(), "yyyy-MM-dd"));
      setDescription(editing?.description ?? "");
    }
  }, [open, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !amount || !date) {
      return toast.error("Fill required fields");
    }
    if (category === "Others" && !othersText.trim()) {
      return toast.error("Please specify the 'Others' category");
    }
    setBusy(true);
    const finalCategory =
      category === "Others" ? `Others - ${othersText.trim()}` : category;

    // Resolve or generate valid expense_code (e.g. EXP050926001)
    let code = (editing?.expense_code || "").replace(/^#/, "").trim();
    if (!code) {
      let expCode: string | null = null;
      try {
        const { data } = await supabase.rpc("generate_expense_id", {
          p_date: date,
        });
        expCode = data;
      } catch {
        expCode = null;
      }

      code = expCode || "";
      if (!code) {
        for (let i = 0; i < 5; i++) {
          const tryCode = generateExpenseCode(new Date(date)); // EXPddMMyyXXX
          const { data } = await supabase
            .from("expenses")
            .select("id")
            .eq("expense_code", tryCode)
            .limit(1);
          if (!data || data.length === 0) {
            code = tryCode;
            break;
          }
        }
        code =
          code ||
          generateExpenseCode(new Date(date)) + Math.floor(Math.random() * 10);
      }
    }

    const payload: any = {
      title: title.trim(),
      amount: Number(amount),
      category: finalCategory,
      expense_date: date,
      description: description?.trim() || null,
      expense_code: code,
    };

    const { data: savedData, error } = editing
      ? await supabase
          .from("expenses")
          .update(payload)
          .eq("id", editing.id)
          .select()
          .maybeSingle()
      : await supabase
          .from("expenses")
          .insert(payload)
          .select()
          .maybeSingle();

    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Expense updated" : "Expense added");

    // Strictly pass the expense_code (e.g. EXP050926B0D) as reference_id, NEVER the literal "expense"
    const finalCode = (code || savedData?.expense_code || editing?.id || "").replace(/^#/, "").trim();
    const expCodeDisplay = finalCode ? `#${finalCode}` : "";
    const expTitle = editing
      ? `Expense updated: ${fmtAED(payload.amount)} - ${payload.title} (${payload.category})`
      : `Expense ${fmtAED(payload.amount)} - ${payload.title} (${payload.category})`;
    const expDesc = `${payload.category} · ${fmtAED(payload.amount)}${expCodeDisplay ? ` - ${expCodeDisplay}` : ""}${payload.description ? ` · Note: ${payload.description}` : ""}`;

    await logActivity(
      editing ? "expense_edited" : "expense_created",
      expTitle,
      finalCode || undefined,
      expDesc
    );

    onOpenChange(false);
    if (onSuccess && savedData) {
      onSuccess(savedData as Expense);
    }
    qc.invalidateQueries({ queryKey: ["expenses-month"] });
    qc.invalidateQueries({ queryKey: ["expenses-chart"] });
    qc.invalidateQueries({ queryKey: ["expenses-prev"] });
    qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
    qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
    qc.invalidateQueries({ queryKey: ["expenses-breakdown"] });
    qc.invalidateQueries({ queryKey: ["expenses-lookup-logs"] });
    qc.invalidateQueries({ queryKey: ["expense-detail"] });
    qc.invalidateQueries({ queryKey: ["activity-logs"] });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Expense" : "Add New Expense"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label>Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Office Rent July 2026"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (AED) *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Date *</Label>
              <DatePickerField value={date} onChange={setDate} />
            </div>
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {category === "Others" && (
            <div>
              <Label>Please specify *</Label>
              <Input
                value={othersText}
                onChange={(e) => setOthersText(e.target.value)}
                placeholder="e.g. Fabric samples, Client gift..."
                required
              />
            </div>
          )}
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={description ?? ""}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="gold-gradient"
            >
              {busy ? "Saving…" : "Save Expense"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
