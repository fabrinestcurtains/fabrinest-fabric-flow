import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://hhonwrvvsnkqlwhysnkx.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_9RH18xX3PqabjHHw6T1O_Q_hPprxnq5";

export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: typeof window !== "undefined",
    storageKey: "fabrinest-auth",
  },
});

export type Customer = {
  id: string;
  name: string;
  mobile: string;
  address: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderStatus =
  | "New Order"
  | "Measurement Complete"
  | "In Process"
  | "Completed"
  | "Cancelled";
export type PaymentStatus = "Unpaid" | "Partial Paid" | "Full Paid";

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  status: OrderStatus;
  changed_at: string;
  note: string | null;
};
export type PaymentStatusDisplay = PaymentStatus | "Cancelled";

export type RoomWindow = {
  id: string;
  wname: string;
  size: string;
  style: string;
  fabric: string;
  note: string;
};
export type OrderRoom = { id: string; name: string; windows: RoomWindow[] };

export type Order = {
  id: string;
  customer_id: string;
  order_details: string | null;
  rooms: OrderRoom[] | null;
  additional_info: string | null;
  order_date: string;
  delivery_date: string | null;
  total_amount: number;
  advance_amount: number;
  discount_amount: number;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  salesman_name: string | null;
  fixing_man_name: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  customers?: Customer | null;
};

export type PaymentType = "payment" | "refund";

export type Payment = {
  id: string;
  order_id: string;
  amount: number;
  payment_date: string;
  payment_type: PaymentType;
  note: string | null;
  created_at: string;
};

export type Expense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanySettings = {
  id: string;
  company_name: string | null;
  tagline: string | null;
  address: string | null;
  mobile: string | null;
  website: string | null;
  email: string | null;
  logo_url: string | null;
  updated_at: string;
};

export type NoteColor = "default" | "yellow" | "blue" | "green" | "pink";

export type Note = {
  id: string;
  title: string;
  content: string | null;
  is_pinned: boolean;
  color: NoteColor;
  created_at: string;
  updated_at: string;
};

export const EXPENSE_CATEGORIES = [
  "Rent / Showroom",
  "Staff Salary",
  "Transport & Delivery",
  "Raw Materials & Fabric",
  "Tools & Equipment",
  "Marketing & Advertising",
  "Fixing Man",
  "Labour",
  "Others",
] as const;

export const ACTIVE_ORDERS_FILTER = "is_deleted.is.null,is_deleted.eq.false";

export const sanitizeSearch = (s: string) =>
  s.replace(/[%_(),]/g, "").trim().slice(0, 50);


export type ActivityLog = {
  id: string;
  activity_type: string;
  title: string;
  reference_id: string | null;
  description: string | null;
  created_at: string;
};

export async function logActivity(
  activity_type: string,
  title: string,
  reference_id?: string,
  description?: string,
) {
  try {
    await supabase.from("activity_logs").insert({
      activity_type,
      title,
      reference_id: reference_id ?? null,
      description: description ?? null,
    });
  } catch {
    /* logging must never block the main action */
  }
}
