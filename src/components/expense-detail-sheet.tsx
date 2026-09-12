import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatInTimeZone } from "date-fns-tz";
import { isValid } from "date-fns";
import {
  Receipt,
  Pencil,
  Trash2,
  Calendar,
  Clock,
  Tag,
  FileText,
  Hash,
  Loader2,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase, logActivity, type Expense } from "@/lib/supabase";
import { fmtAED, fmtDate } from "@/lib/format";
import { ExpenseFormDialog } from "@/components/expense-form-dialog";

export function ExpenseCategoryBadge({
  category,
  className = "",
}: {
  category: string;
  className?: string;
}) {
  const isOthers = category.startsWith("Others");
  return (
    <span
      title={category}
      className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-medium border shrink-0 ${
        isOthers
          ? "bg-gray-100 border-gray-200 text-gray-700"
          : "bg-gold-50 border-gold-100 text-gold-800"
      } ${className}`}
    >
      <span className="truncate">{category}</span>
    </span>
  );
}

function formatDubaiDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (!isValid(d)) return "—";
    return `${formatInTimeZone(d, "Asia/Dubai", "dd MMM, yyyy hh:mm a")} (Dubai)`;
  } catch {
    return "—";
  }
}

interface ExpenseDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: Expense | null;
  expenseId?: string | null;
  onEdit?: (expense: Expense) => void;
  onDelete?: (expenseId: string) => void;
}

export function ExpenseDetailSheet({
  open,
  onOpenChange,
  expense,
  expenseId,
  onEdit,
  onDelete,
}: ExpenseDetailSheetProps) {
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [internalEditOpen, setInternalEditOpen] = useState(false);

  // Fetch expense if only expenseId was provided
  const expenseQ = useQuery({
    queryKey: ["expense-detail", expenseId],
    enabled: !expense && !!expenseId && open,
    queryFn: async () => {
      const cleanId = (expenseId || "").trim().replace(/^#/, "");
      if (!cleanId || cleanId.toLowerCase() === "expense") return null;

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId);
      const isExp = cleanId.toUpperCase().startsWith("EXP");

      const orClause = isExp
        ? (isUuid
            ? `expense_code.eq.${cleanId},expense_code.ilike.${cleanId},id.eq.${cleanId}`
            : `expense_code.eq.${cleanId},expense_code.ilike.${cleanId}`)
        : (isUuid
            ? `id.eq.${cleanId},expense_code.eq.${cleanId},expense_code.ilike.${cleanId}`
            : `expense_code.eq.${cleanId},expense_code.ilike.${cleanId}`);

      const { data } = await supabase
        .from("expenses")
        .select("*")
        .or(orClause)
        .limit(1)
        .maybeSingle();

      return (data ?? null) as Expense | null;
    },
  });

  const currentExpense = expense ?? expenseQ.data ?? null;
  const isLoading = !expense && !!expenseId && expenseQ.isLoading;

  const expCode = currentExpense
    ? currentExpense.expense_code
      ? `#${currentExpense.expense_code.replace(/^#/, "")}`
      : `#${currentExpense.id.slice(0, 8)}`
    : "";

  const handleDelete = async () => {
    if (!currentExpense) return;
    if (onDelete) {
      onDelete(currentExpense.id);
      setDeleteOpen(false);
      onOpenChange(false);
      return;
    }

    setIsDeleting(true);
    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", currentExpense.id);
    setIsDeleting(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Expense deleted");
      const delCode = (currentExpense.expense_code || currentExpense.id || "").replace(/^#/, "").trim();
      await logActivity(
        "expense_deleted",
        `Expense deleted: ${fmtAED(Number(currentExpense.amount))} - ${currentExpense.title} (${currentExpense.category})`,
        delCode || undefined,
        `${currentExpense.category} · ${fmtAED(Number(currentExpense.amount))}${delCode ? ` - ${delCode}` : ""}`
      );
      setDeleteOpen(false);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["expenses-list-paged"] });
      qc.invalidateQueries({ queryKey: ["expenses-month-summary"] });
      qc.invalidateQueries({ queryKey: ["expenses-month"] });
      qc.invalidateQueries({ queryKey: ["expenses-chart"] });
      qc.invalidateQueries({ queryKey: ["expenses-breakdown"] });
      qc.invalidateQueries({ queryKey: ["expenses-lookup-logs"] });
      qc.invalidateQueries({ queryKey: ["activity-logs"] });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="pb-2 border-b border-gold-100">
            <div className="flex items-center justify-between gap-2 pr-6">
              <SheetTitle className="text-lg font-bold text-gold-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-gold-600" />
                Expense {expCode}
              </SheetTitle>
              {currentExpense && (
                <ExpenseCategoryBadge category={currentExpense.category} />
              )}
            </div>
          </SheetHeader>

          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-gold-600" />
              <span>Loading expense details…</span>
            </div>
          ) : !currentExpense ? (
            <div className="py-16 text-center text-muted-foreground">
              Expense details not found or removed.
            </div>
          ) : (
            <div className="space-y-5 pt-4">
              {/* Highlight Card: Amount & Title */}
              <div className="rounded-xl border border-gold-200 bg-gradient-to-br from-gold-50/50 via-white to-gold-50/30 p-4 shadow-xs">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Expense Amount
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-emerald-700 mt-1">
                  {fmtAED(currentExpense.amount)}
                </div>
                <div className="text-sm font-medium text-gold-950 mt-1.5 break-words">
                  {currentExpense.title}
                </div>
              </div>

              {/* Information Grid */}
              <div className="rounded-xl border border-gold-100 bg-white p-4 space-y-3.5 shadow-2xs">
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold border-b border-gold-50 pb-2">
                  Expense Information
                </div>

                {/* Custom Expense ID */}
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Hash className="w-4 h-4 text-gold-600 shrink-0" />
                    <span>Expense ID</span>
                  </div>
                  <span className="font-mono font-bold text-gold-900 bg-gold-50/70 border border-gold-200 px-2 py-0.5 rounded text-xs">
                    {expCode}
                  </span>
                </div>

                {/* Title */}
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="w-4 h-4 text-gold-600 shrink-0" />
                    <span>Title</span>
                  </div>
                  <span className="font-medium text-gold-950 text-right max-w-[65%] break-words">
                    {currentExpense.title}
                  </span>
                </div>

                {/* Category */}
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag className="w-4 h-4 text-gold-600 shrink-0" />
                    <span>Category</span>
                  </div>
                  <ExpenseCategoryBadge category={currentExpense.category} />
                </div>

                {/* Date */}
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4 text-gold-600 shrink-0" />
                    <span>Expense Date</span>
                  </div>
                  <span className="font-semibold text-gold-900">
                    {fmtDate(currentExpense.expense_date)}
                  </span>
                </div>

                {/* Description */}
                <div className="pt-2 border-t border-gold-50">
                  <div className="text-xs text-muted-foreground font-medium mb-1">
                    Description / Note:
                  </div>
                  <div className="text-xs text-gold-950 bg-gold-50/30 p-2.5 rounded-lg border border-gold-100 whitespace-pre-wrap min-h-[48px]">
                    {currentExpense.description || "No description provided."}
                  </div>
                </div>

                {/* Timestamps in Dubai timezone */}
                <div className="pt-2 border-t border-gold-50 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gold-500 shrink-0" /> Created
                      At
                    </span>
                    <span className="font-medium text-gold-900">
                      {formatDubaiDateTime(currentExpense.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gold-500 shrink-0" /> Last
                      Updated
                    </span>
                    <span className="font-medium text-gold-900">
                      {formatDubaiDateTime(currentExpense.updated_at)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons: matching OrderDetailSheet theme */}
              <div className="space-y-2 pt-2">
                <Button
                  variant="outline"
                  className="w-full border-gold-300 text-gold-800 hover:bg-gold-50 min-h-[40px] font-medium"
                  onClick={() => {
                    if (onEdit) {
                      onEdit(currentExpense);
                    } else {
                      setInternalEditOpen(true);
                    }
                  }}
                >
                  <Pencil className="w-4 h-4 mr-2 text-gold-600" />
                  Edit Expense
                </Button>

                <Button
                  variant="outline"
                  className="w-full border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 min-h-[40px] font-medium"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2 text-red-500" />
                  Delete Expense
                </Button>

                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Internal Edit Dialog when onEdit is not supplied (e.g. from Logs page) */}
      {internalEditOpen && currentExpense && (
        <ExpenseFormDialog
          open={internalEditOpen}
          onOpenChange={setInternalEditOpen}
          editing={currentExpense}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["expense-detail", expenseId] });
          }}
        />
      )}

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete expense{" "}
              <strong>{expCode}</strong> ({currentExpense?.title} —{" "}
              {fmtAED(currentExpense?.amount)})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

