import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, Sparkles, HardDriveUpload, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase, type CompanySettings } from "@/lib/supabase";

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ["company_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
      return data as CompanySettings | null;
    },
  });

  const [form, setForm] = useState<Partial<CompanySettings>>({});
  useEffect(() => { if (settingsQ.data) setForm(settingsQ.data); }, [settingsQ.data]);

  const [uploading, setUploading] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  const saveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingInfo(true);
    const payload = {
      company_name: form.company_name,
      tagline: form.tagline,
      address: form.address,
      mobile: form.mobile,
      website: form.website,
      email: form.email,
      updated_at: new Date().toISOString(),
    };
    const { error } = !settingsQ.data
      ? await supabase.from("company_settings").insert(payload)
      : await supabase.from("company_settings").update(payload).eq("id", settingsQ.data.id);
    setSavingInfo(false);
    if (error) return toast.error(error.message);
    toast.success("Company info saved");
    qc.invalidateQueries({ queryKey: ["company_settings"] });
  };

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Only image files allowed");
      if (file.size > 2 * 1024 * 1024) throw new Error("Max file size 2MB");
      if (file.size === 0) throw new Error("Empty file");
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["jpg", "jpeg", "png", "webp", "svg"].includes(ext || "")) throw new Error("Invalid image format");

      const path = `logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("company-logos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("company-logos").getPublicUrl(path);

      if (!settingsQ.data) {
        const { error: dbErr } = await supabase.from("company_settings").insert({ logo_url: urlData.publicUrl });
        if (dbErr) throw dbErr;
      } else {
        const { error: dbErr } = await supabase.from("company_settings").update({ logo_url: urlData.publicUrl }).eq("id", settingsQ.data.id);
        if (dbErr) throw dbErr;
      }
      toast.success("Logo updated");
      qc.invalidateQueries({ queryKey: ["company_settings"] });
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // Password
  const [current, setCurrent] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const [backupBusy, setBackupBusy] = useState(false);

  const lastBackupQ = useQuery({
    queryKey: ["last-backup-log"],
    queryFn: async () => {
      const { data } = await supabase
        .from("backup_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as {
        id: string;
        backup_date: string;
        month_label: string;
        pdf_url: string | null;
        excel_url: string | null;
        status: "success" | "failed";
        error_message: string | null;
        triggered_by: "auto" | "manual";
        created_at: string;
      } | null;
    },
  });

  const runBackupNow = async () => {
    setBackupBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("drive-backup", { body: {} });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? "Backup failed");
      toast.success("Backup complete! Files saved to Google Drive.");
      qc.invalidateQueries({ queryKey: ["last-backup-log"] });
    } catch (err: any) {
      toast.error(err.message || "Backup failed. Check Drive setup.");
    } finally {
      setBackupBusy(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw1.length < 8) return toast.error("New password must be at least 8 characters");
    if (pw1 !== pw2) return toast.error("Passwords do not match");
    setPwBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user?.email) { setPwBusy(false); return toast.error("Not signed in"); }
    // Verify current password
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: userData.user.email, password: current });
    if (signErr) { setPwBusy(false); return toast.error("Current password is incorrect"); }
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setPwBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setCurrent(""); setPw1(""); setPw2("");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="bg-white border border-gold-100 rounded-xl p-5">
        <h3 className="font-semibold text-gold-900 mb-3">Company Logo</h3>
        <label className="block border-2 border-dashed border-gold-200 rounded-lg p-6 text-center cursor-pointer hover:bg-gold-50">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }}
          />
          {form.logo_url ? (
            <img src={form.logo_url} alt="Logo" className="mx-auto w-24 h-24 object-cover rounded-lg mb-2" />
          ) : (
            <div className="mx-auto w-24 h-24 rounded-lg gold-gradient flex items-center justify-center mb-2">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            <Upload className="inline w-4 h-4 mr-1" />
            {uploading ? "Uploading…" : "Click or drop an image to upload"}
          </div>
        </label>
      </section>

      <section className="bg-white border border-gold-100 rounded-xl p-5">
        <h3 className="font-semibold text-gold-900 mb-3">Company Information</h3>
        <form onSubmit={saveInfo} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Company Name *</Label>
            <Input value={form.company_name ?? ""} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
          </div>
          <div>
            <Label>Tagline</Label>
            <Input value={form.tagline ?? ""} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Premium Curtains for Every Space" />
          </div>
          <div className="md:col-span-2">
            <Label>Address</Label>
            <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <Label>Mobile Number</Label>
            <Input type="tel" value={form.mobile ?? ""} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Website</Label>
            <Input type="url" value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" className="gold-gradient" disabled={savingInfo}>{savingInfo ? "Saving…" : "Save Changes"}</Button>
          </div>
        </form>
      </section>

      <section className="bg-white border border-gold-100 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDriveUpload className="w-5 h-5 text-gold-700" />
            <h3 className="font-semibold text-gold-900">Google Drive Backup</h3>
          </div>
          <Button
            onClick={runBackupNow}
            disabled={backupBusy}
            className="gold-gradient flex items-center gap-2"
          >
            {backupBusy ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Backing up…</>
            ) : (
              <><HardDriveUpload className="w-4 h-4" /> Backup Now</>
            )}
          </Button>
        </div>

        <div className="rounded-lg bg-amber-50 border border-amber-100 p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-amber-800 font-medium">
            <span className="text-xs bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">Auto</span>
            Daily backup runs every night at 11:59 PM Dubai time (19:59 UTC) - configured in Supabase cron
          </div>
          <div className="text-xs text-muted-foreground">
            📁 Google Drive → <span className="font-mono">Fabrinest Reports / {new Date().getFullYear()} / {new Date().toLocaleString("en-US", { month: "long" })}</span>
          </div>
        </div>

        {lastBackupQ.isLoading ? (
          <div className="mt-3 h-10 rounded-lg bg-gold-50 animate-pulse" />
        ) : lastBackupQ.data ? (
          <div className="mt-3 rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {lastBackupQ.data.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-600" />
                )}
                <span className={`text-sm font-medium ${lastBackupQ.data.status === "success" ? "text-green-700" : "text-red-700"}`}>
                  {lastBackupQ.data.status === "success" ? "Last backup successful" : "Last backup failed"}
                </span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {lastBackupQ.data.triggered_by === "auto" ? "Auto" : "Manual"}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(lastBackupQ.data.created_at).toLocaleString("en-US", {
                  day: "2-digit", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit", hour12: true,
                })}
              </span>
            </div>

            {lastBackupQ.data.status === "success" && (
              <div className="flex items-center gap-3 pt-1">
                {lastBackupQ.data.pdf_url && (
                  <a
                    href={lastBackupQ.data.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> View PDF
                  </a>
                )}
                {lastBackupQ.data.excel_url && (
                  <a
                    href={lastBackupQ.data.excel_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-green-600 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> View Excel
                  </a>
                )}
              </div>
            )}

            {lastBackupQ.data.status === "failed" && lastBackupQ.data.error_message && (
              <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">
                {lastBackupQ.data.error_message}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground text-center py-3 border rounded-lg border-dashed">
            No backups yet — first backup runs tonight at 11:59 PM, or press "Backup Now"
          </div>
        )}
      </section>

      <section className="bg-white border border-gold-100 rounded-xl p-5">
        <h3 className="font-semibold text-gold-900 mb-3">Change Password</h3>
        <form onSubmit={changePassword} className="space-y-3 max-w-md">
          <div>
            <Label>Current Password</Label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div>
            <Label>New Password</Label>
            <Input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} required autoComplete="new-password" minLength={8} />
          </div>
          <div>
            <Label>Confirm New Password</Label>
            <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required autoComplete="new-password" />
          </div>
          <Button type="submit" disabled={pwBusy} className="gold-gradient">{pwBusy ? "Updating…" : "Update Password"}</Button>
        </form>
      </section>
    </div>
  );
}
