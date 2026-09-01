import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const safePath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/auth", search: { redirect: safePath } });
    }
  },
  component: Layout,
});

function Layout() {
  const { loading, user } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
