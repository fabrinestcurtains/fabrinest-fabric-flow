import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Wallet,
  BarChart2,
  StickyNote,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Sparkles,
  Activity,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase, type CompanySettings } from "@/lib/supabase";

const dubaiTime = () =>
  new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/orders", label: "Order History", icon: ClipboardList },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/expenses", label: "Expenses", icon: Wallet },
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/logs", label: "Activity Log", icon: Activity },
  { to: "/notes", label: "Notes", icon: StickyNote },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const titleFor = (path: string) => {
  if (path === "/") return "Dashboard";
  const item = NAV.find((n) => path.startsWith(n.to) && n.to !== "/");
  return item?.label ?? "Dashboard";
};

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState(dubaiTime);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: company } = useQuery({
    queryKey: ["company_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
      return data as CompanySettings | null;
    },
  });

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setClock(dubaiTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  const onLogout = async () => {
    await signOut();
    navigate({ to: "/auth" });
  };

  const path = location.pathname;
  const isActive = (to: string, exact?: boolean) => (exact ? path === to : path === to || path.startsWith(to + "/"));

  const Sidebar = (
    <aside className="sidebar-gradient text-white w-[240px] shrink-0 flex flex-col h-full">
      <div className="px-5 py-6 flex items-center gap-3 border-b border-white/10">
        {company?.logo_url ? (
          <img src={company.logo_url} alt="Logo" className="w-10 h-10 rounded-lg object-cover bg-white/10" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-gold-300" />
          </div>
        )}
        <div className="leading-tight">
          <div className="font-bold tracking-widest text-sm">FABRINEST</div>
          <div className="text-[10px] text-gold-300 tracking-[0.2em]">INVENTORY</div>
        </div>
      </div>
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const active = isActive(item.to, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors border-l-2 min-h-[44px] ${
                active
                  ? "border-gold-300 bg-white/10 text-gold-200 font-medium"
                  : "border-transparent text-white/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full gold-gradient flex items-center justify-center text-sm font-bold">
            A
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Admin</div>
            <div className="text-[11px] text-white/60 truncate">{user?.email}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 text-sm text-white/80 hover:text-white px-3 py-2 rounded-md hover:bg-white/5 min-h-[40px]"
        >
          <LogOut className="w-4 h-4" /> Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen flex w-full" style={{ background: "var(--color-gold-50)" }}>
      <div className="hidden md:flex">{Sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[240px]">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 flex items-center justify-between px-4 md:px-6 bg-white/80 backdrop-blur border-b border-gold-100">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden p-2 -ml-2 rounded-md hover:bg-gold-50"
              aria-label="Toggle menu"
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div>
              <h1 className="font-bold text-gold-900 text-base md:text-lg leading-tight">{titleFor(path)}</h1>
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(), "dd/MM/yyyy")} · Dubai, UAE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Dubai {clock}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
