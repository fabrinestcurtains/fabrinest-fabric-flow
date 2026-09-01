import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const search = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: search,
  component: AuthPage,
});

const isSafeRedirect = (r?: string | null): r is string => {
  if (!r) return false;
  if (!r.startsWith("/")) return false;
  if (r.startsWith("//")) return false;
  if (r.includes("://")) return false;
  return true;
};

function AuthPage() {
  const { signIn, user, loading } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const safeRedirect = isSafeRedirect(redirect) ? redirect : "/";

  useEffect(() => {
    if (!loading && user) navigate({ to: safeRedirect as any });
  }, [user, loading, navigate, safeRedirect]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
    else {
      toast.success("Welcome back!");
      navigate({ to: safeRedirect as any });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--color-gold-50)" }}>
      <div className="w-full max-w-md bg-white rounded-2xl border border-gold-100 shadow-[var(--shadow-elegant)] p-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-2xl gold-gradient flex items-center justify-center shadow-[var(--shadow-elegant)]">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-widest text-gold-900">FABRINEST CURTAIN</h1>
          <p className="text-sm text-muted-foreground">Inventory Management</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <Button type="submit" disabled={busy} className="w-full gold-gradient hover:opacity-90 h-11 font-semibold">
            {busy ? "Signing in…" : "Sign In"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground text-center mt-6">
          Admin access only. Contact the administrator for credentials.
        </p>
      </div>
    </div>
  );
}
