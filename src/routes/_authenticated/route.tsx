import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const safePath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/auth", search: { redirect: safePath } });
    }
  },
  component: Layout,
});

function Layout() {
  const { user } = useAuth();
  // beforeLoad already ensures session exists, so if no user, return null without Loading flash
  if (!user) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
