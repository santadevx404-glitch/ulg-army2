import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { BadgeCheck, Camera, KeyRound, LogOut, Settings, Trash2 } from "lucide-react";
import { logoutFn } from "@/lib/server-fns";
import { changeMyPasswordFn, setMyTitleFn } from "@/lib/account-fns";
import { useMe } from "@/lib/use-me";
import { Avatar } from "@/components/Avatar";
import { TAB_LABELS, type TabId } from "@/lib/permissions";

/** بيقص الصورة مربعة من النص ويصغّرها 512px ويحوّلها JPEG عشان تبقى خفيفة. */
async function prepareAvatar(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("نوع الصورة مش مدعوم (JPG / PNG / WEBP / GIF)");
  if (file.size > 25 * 1024 * 1024) throw new Error("الصورة كبيرة جدًا");
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(512, side);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  for (const q of [0.88, 0.7, 0.5]) {
    const out: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", q));
    if (out && out.size <= 2 * 1024 * 1024) return out;
  }
  throw new Error("الصورة أكبر من 2 ميجا");
}

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "حسابي — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, loading } = useMe();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);

  if (loading || !me) return <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>;

  const tabs = me.tabs as TabId[];

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await changeMyPasswordFn({ data: { oldPassword: oldPw, newPassword: newPw } });
      if (res.error) throw new Error(res.error);
      toast.success("تم تغيير كلمة المرور"); setOldPw(""); setNewPw("");
    } catch (err: any) { toast.error(err.message || "حدث خطأ"); }
    finally { setSaving(false); }
  };

  const changeAvatar = async (file: File) => {
    setAvatarBusy(true);
    try {
      const blob = await prepareAvatar(file);
      const r = await fetch("/api/avatar", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "فشل رفع الصورة");
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تغيير الصورة");
    } catch (err: any) { toast.error(err.message || "حدث خطأ"); }
    finally { setAvatarBusy(false); }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await fetch("/api/avatar", { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم حذف الصورة");
    } catch { toast.error("حدث خطأ"); }
    finally { setAvatarBusy(false); }
  };

  const saveTitle = async () => {
    try {
      await setMyTitleFn({ data: title ?? "" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("تم تغيير اللقب");
      setTitle(null);
    } catch (err: any) { toast.error(err.message || "حدث خطأ"); }
  };

  const logout = async () => {
    await logoutFn();
    await qc.invalidateQueries({ queryKey: ["me"] });
    navigate({ to: "/" });
  };

  const row = (label: string, value: string | null) => (
    <div className="flex justify-between gap-4 py-2 border-b border-border/50 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold" dir="auto">{value || "—"}</span>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="mil-card p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="relative">
              <Avatar name={me.owner ? me.display_title || "الأدمن الأساسي" : me.character_name || me.account_name} src={me.avatar} size={72} />
              <label className={`absolute -bottom-1 -left-1 p-1.5 rounded-full bg-[var(--gold)] text-black cursor-pointer ${avatarBusy ? "opacity-50 pointer-events-none" : ""}`} title="تغيير الصورة">
                <Camera className="h-4 w-4" />
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) changeAvatar(f); e.target.value = ""; }} />
              </label>
            </div>
            <h1 className="flex-1 text-2xl font-black gold-text">{me.owner ? me.display_title || "الأدمن الأساسي" : me.account_name || "حسابي"}</h1>
            {me.avatar && (
              <button onClick={removeAvatar} disabled={avatarBusy} title="حذف الصورة" className="p-2 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            )}
          </div>
          {!me.owner && (
            <>
              {row("اسم الحساب", me.account_name)}
              {row("اسم الشخصية", me.character_name)}
              {row("الكود العسكري", me.military_code)}
              {row(me.rank_names.length > 1 ? "الرتب" : "الرتبة", me.rank_names.length ? me.rank_names.join("، ") : me.rank_requested)}
            </>
          )}
          {row("الإيميل", me.email)}
        </div>

        {me.owner && (
          <div className="mil-card p-6">
            <h2 className="font-bold mb-1 flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-[var(--gold)]" />اللقب اللي بيظهر ليك</h2>
            <p className="text-xs text-muted-foreground mb-3">بيظهر بدل «الأدمن الأساسي» في قايمة الأعضاء والسجل. سيبه فاضي للرجوع للاسم الافتراضي.</p>
            <div className="flex gap-2">
              <input className="input flex-1" maxLength={40} placeholder="الأدمن الأساسي" value={title ?? me.display_title ?? ""} onChange={(e) => setTitle(e.target.value)} />
              <button onClick={saveTitle} disabled={title === null} className="btn-gold ripple disabled:opacity-40">حفظ</button>
            </div>
          </div>
        )}

        <div className="mil-card p-6">
          <h2 className="font-bold mb-3 flex items-center gap-2"><Settings className="h-4 w-4 text-[var(--gold)]" />المتاح ليك في لوحة التحكم</h2>
          {tabs.length === 0 ? (
            <p className="text-sm text-muted-foreground">لسه مفيش صلاحيات اتدّتلك. لما الإدارة تدّيك رتبة هتظهر هنا.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {tabs.map((t) => <span key={t} className="text-xs px-3 py-1 rounded-full bg-[var(--gold)]/15 text-[var(--gold)]">{TAB_LABELS[t]}</span>)}
              </div>
              <Link to="/admin" className="btn-gold ripple inline-block">فتح لوحة التحكم</Link>
            </>
          )}
        </div>

        <form onSubmit={changePw} className="mil-card p-6 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--gold)]" />تغيير كلمة المرور</h2>
          <input type="password" required dir="ltr" placeholder="كلمة المرور الحالية" value={oldPw} onChange={(e) => setOldPw(e.target.value)} className="input" />
          <input type="password" required minLength={6} dir="ltr" placeholder="كلمة المرور الجديدة" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="input" />
          <button type="submit" disabled={saving} className="btn-gold ripple disabled:opacity-50">{saving ? "..." : "تغيير"}</button>
        </form>

        <button onClick={logout} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive"><LogOut className="h-4 w-4" />تسجيل خروج</button>
      </motion.div>
    </div>
  );
}
