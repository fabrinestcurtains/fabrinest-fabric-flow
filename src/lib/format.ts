import { format, isValid, parseISO } from "date-fns";
import type { OrderStatus, PaymentStatus, PaymentStatusDisplay } from "./supabase";

export const fmtAED = (n: number | null | undefined) =>
  `AED ${(Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export const fmtAEDShort = (n: number) => {
  const v = Number(n) || 0;
  if (v >= 1000) return `AED ${(v / 1000).toFixed(1)}K`;
  return `AED ${v}`;
};

export const fmtDate = (d?: string | Date | null) => {
  if (!d) return "—";
  try {
    const date = typeof d === "string" ? parseISO(d) : d;
    if (!isValid(date) || isNaN(date.getTime())) return "—";
    return format(date, "dd/MM/yyyy");
  } catch {
    return "—";
  }
};

export const fmtDateTime = (d?: string | Date | null) => {
  if (!d) return "—";
  try {
    const date = typeof d === "string" ? parseISO(d) : d;
    if (!isValid(date) || isNaN(date.getTime())) return "—";
    return format(date, "dd/MM/yyyy HH:mm");
  } catch {
    return "—";
  }
};

type OrderLike = {
  total_amount: number;
  advance_amount: number;
  discount_amount?: number | null;
  order_status?: OrderStatus;
};

export const ONGOING_STATUSES: OrderStatus[] = ["New Order", "Measurement Complete", "In Process"];
export const isOngoing = (s: OrderStatus) => ONGOING_STATUSES.includes(s);

/** Due amount respecting discount + cancelled orders. */
export const dueOf = (o: OrderLike): number => {
  if (o.order_status === "Cancelled") return 0;
  const t = Number(o.total_amount) || 0;
  const a = Number(o.advance_amount) || 0;
  const d = Number(o.discount_amount) || 0;
  return Math.max(0, t - d - a);
};

export const netOf = (o: OrderLike): number => {
  const t = Number(o.total_amount) || 0;
  const d = Number(o.discount_amount) || 0;
  return Math.max(0, t - d);
};

export const computePaymentStatus = (
  total: number,
  advance: number,
  discount = 0,
): PaymentStatus => {
  const net = Math.max(0, (Number(total) || 0) - (Number(discount) || 0));
  const a = Number(advance) || 0;
  if (a <= 0) return "Unpaid";
  if (a >= net) return "Full Paid";
  return "Partial Paid";
};

/** Payment status shown to the user; cancelled orders always render as Cancelled. */
export const displayPaymentStatus = (o: {
  order_status: OrderStatus;
  payment_status: PaymentStatus;
}): PaymentStatusDisplay => (o.order_status === "Cancelled" ? "Cancelled" : o.payment_status);

export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const monthLabel = (d: Date) => format(d, "MMMM yyyy");

export function listMonthsSince(startYear = 2025) {
  const arr: { value: string; label: string; date: Date }[] = [];
  const now = new Date();
  const start = new Date(startYear, 0, 1);
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const d = new Date(start);
  while (d <= cur) {
    arr.push({ value: monthKey(d), label: monthLabel(d), date: new Date(d) });
    d.setMonth(d.getMonth() + 1);
  }
  return arr.reverse();
}

/**
 * Returns current date/time adjusted to Dubai timezone (Asia/Dubai, UTC+4).
 * Note: Server cron jobs in Supabase run in UTC (19:59 UTC = 11:59 PM Dubai).
 */
export const getDubaiNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
export const dubaiNow = getDubaiNow;

