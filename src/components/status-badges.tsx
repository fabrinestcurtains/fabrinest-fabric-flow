import type { OrderStatus, PaymentStatusDisplay } from "@/lib/supabase";

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  "New Order": "bg-blue-50 text-blue-700 border-blue-200",
  "Measurement Complete": "bg-purple-50 text-purple-700 border-purple-200",
  "In Process": "bg-amber-50 text-amber-700 border-amber-200",
  Completed: "bg-green-50 text-green-700 border-green-200",
  Cancelled: "bg-red-50 text-red-700 border-red-200",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ORDER_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatusDisplay }) {
  const map: Record<PaymentStatusDisplay, string> = {
    "Full Paid": "bg-green-50 text-green-700 border-green-200",
    "Partial Paid": "bg-amber-50 text-amber-700 border-amber-200",
    Unpaid: "bg-red-50 text-red-700 border-red-200",
    Cancelled: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

export function statusBorderClass(status: OrderStatus) {
  switch (status) {
    case "New Order":
      return "border-l-blue-400";
    case "Measurement Complete":
      return "border-l-purple-400";
    case "In Process":
      return "border-l-amber-400";
    case "Completed":
      return "border-l-green-500";
    case "Cancelled":
      return "border-l-red-500";
  }
}
