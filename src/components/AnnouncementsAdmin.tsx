// تاب إدارة الإعلانات في لوحة التحكم.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Save, Megaphone, ImagePlus, Loader2, X } from "lucide-react";
import { announcementsAdminFn, announcementOptionsFn, saveAnnouncementFn, deleteAnnouncementFn, type AnnouncementAdminRow } from "@/lib/announcement-fns";
import { useMe } from "@/lib/use-me";
import { prepareImage } from "@/lib/image-utils";
import { Field, Modal } from "@/components/admin-ui";
import { AnnouncementCard } from "@/components/AnnouncementCard";

const TONE_LABELS: Record<string, string> = { info: "عادي (ذهبي)", success: "نجاح (أخضر)", warning: "تنبيه (برتقالي)", danger: "هام (أحمر)" };
const AUDIENCE_LABELS: Record<string, string> = { everyone: "الكل", members: "المسجّلين بس", ranks: "رتب معينة" };

const toLocalInput = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

function statusOf(a: AnnouncementAdminRow): { label: string; cls: string } {
  const now = Date.now();
  if (!a.enabled) return { label: "موقوف", cls: "bg-destructive/20 text-destructive" };
  if (a.starts_at && now < Date.parse(a.starts_at)) return { label: "مجدول", cls: "bg-amber-500/20 text-amber-400" };
  if (a.ends_at && now >= Date.parse(a.ends_at)) return { label: "منتهي", cls: "bg-white/10 text-muted-foreground" };
  return { label: "شغال", cls: "bg-emerald-500/20 text-emerald-400" };
}

const BLANK: Partial<AnnouncementAdminRow> = {
  title: "", body: "", link_url: null, link_label: null, image: null, targets: ["all"], audience: "everyone", rank_ids: [],
  tone: "info", open_by_default: false, dismissible: true, starts_at: null, ends_at: null, enabled: true, sort_order: 0,
};

export function AnnouncementsAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const { data: rows = [], refetch } = useQuery({ queryKey: ["admin-announcements"], queryFn: () => announcementsAdminFn() });
  const { data: options } = useQuery({ queryKey: ["announcement-options"], queryFn: () => announcementOptionsFn() });
  const [editing, setEditing] = useState<Partial<AnnouncementAdminRow> | null>(null);
  const [uploading, setUploading] = useState(false);
  const [itemSearch, setItemSearch] = useState("");

  const lk = (g: string) => !!editing?.id && !can(`announcements.edit.${g}`, { announcement: editing.id });
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["announcements"] }); };
  const set = (patch: Partial<AnnouncementAdminRow>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const labelOfTarget = (t: string): string => {
    if (t === "all") return "كل الصفحات";
    if (t === "home") return "الرئيسية";
    if (t === "exams") return "الاختبارات";
    if (t === "chat") return "الدردشات";
    if (t.startsWith("section:")) return `قسم: ${options?.sections.find((s) => s.id === t.slice(8))?.name ?? "؟"}`;
    if (t.startsWith("item:")) return `عنصر: ${options?.items.find((i) => i.id === t.slice(5))?.title ?? "؟"}`;
    return t;
  };

  const toggleTarget = (t: string) => {
    const cur = editing?.targets ?? [];
    set({ targets: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const blob = await prepareImage(file, { maxBytes: 4 * 1024 * 1024, maxSide: 1600 });
      const r = await fetch("/api/announcement-image", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "فشل رفع الصورة");
      set({ image: j.name });
    } catch (e: any) { toast.error(e.message || "فشل رفع الصورة"); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (!editing) return;
    try {
      await saveAnnouncementFn({
        data: {
          id: editing.id, title: editing.title ?? "", body: editing.body ?? "", link_url: editing.link_url || null, link_label: editing.link_label || null,
          image: editing.image ?? null, targets: editing.targets ?? [], audience: editing.audience ?? "everyone", rank_ids: editing.rank_ids ?? [],
          tone: editing.tone ?? "info", open_by_default: editing.open_by_default ?? false, dismissible: editing.dismissible ?? true,
          starts_at: editing.starts_at ?? null, ends_at: editing.ends_at ?? null, enabled: editing.enabled ?? true, sort_order: editing.sort_order ?? 0,
        },
      });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ"); setEditing(null); refresh();
  };

  const del = async (a: AnnouncementAdminRow) => {
    if (!confirm(`حذف الإعلان «${a.title}»؟`)) return;
    try { await deleteAnnouncementFn({ data: a.id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };

  const filteredItems = (options?.items ?? []).filter((i) => !itemSearch.trim() || i.title.toLowerCase().includes(itemSearch.trim().toLowerCase()));

  return (
    <div>
      {can("announcements.create") && (
        <button onClick={() => setEditing({ ...BLANK })} className="btn-gold ripple mb-6 inline-flex items-center gap-2"><Plus className="h-4 w-4" />إعلان جديد</button>
      )}

      <div className="grid gap-3">
        {rows.map((a) => {
          const st = statusOf(a);
          return (
            <div key={a.id} className="mil-card p-4 flex items-center gap-4">
              {a.image ? <img src={`/api/announcement-image/${a.image}`} alt="" className="h-14 w-20 rounded-lg object-cover border border-border shrink-0" /> : <Megaphone className="h-6 w-6 text-[var(--gold)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-bold flex items-center gap-2 flex-wrap">
                  <span dir="auto">{a.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">{TONE_LABELS[a.tone]}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  يظهر في: {a.targets.map(labelOfTarget).join("، ")} • لـ {AUDIENCE_LABELS[a.audience]}
                </div>
              </div>
              {a.can.anySettings && <button title="تعديل" onClick={() => setEditing(a)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
              {a.can.delete && <button title="حذف" onClick={() => del(a)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-center text-muted-foreground py-12">لسه مفيش إعلانات.</div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "تعديل إعلان" : "إعلان جديد"} wide>
          <Field label="عنوان الإعلان" locked={lk("title")}><input className="input" maxLength={120} value={editing.title ?? ""} onChange={(e) => set({ title: e.target.value })} /></Field>

          <Field label="صورة الإعلان (اختياري)" locked={lk("image")} hint="الصورة بتنزل مع باقي الإعلان لما الشخص يدوس على السهم. اللي ظاهر فوق العنوان بس.">
            <div className="flex items-center gap-3 flex-wrap">
              {editing.image && <img src={`/api/announcement-image/${editing.image}`} alt="" className="h-24 rounded-lg border border-border object-cover" />}
              <label className="px-3 py-1.5 rounded-md border border-border hover:border-[var(--gold)] text-sm inline-flex items-center gap-2 cursor-pointer">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{editing.image ? "تغيير الصورة" : "رفع صورة"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
              </label>
              {editing.image && <button type="button" onClick={() => set({ image: null })} className="p-1.5 text-muted-foreground hover:text-destructive" title="شيل الصورة"><X className="h-4 w-4" /></button>}
            </div>
          </Field>

          <Field label="نص الإعلان (بيظهر لما الشخص يفتح السهم)" locked={lk("body")}>
            <textarea className="input min-h-28" maxLength={4000} value={editing.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="رابط زرار (اختياري)" locked={lk("body")} hint="https://... أو مسار داخلي زي /exams"><input className="input" dir="ltr" value={editing.link_url ?? ""} onChange={(e) => set({ link_url: e.target.value })} /></Field>
            <Field label="كلمة الزرار" locked={lk("body")}><input className="input" maxLength={40} placeholder="المزيد" value={editing.link_label ?? ""} onChange={(e) => set({ link_label: e.target.value })} /></Field>
          </div>

          <Field label="أماكن ظهور الإعلان" locked={lk("targets")}>
            <div className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {[["all", "كل صفحات الموقع"], ["home", "الصفحة الرئيسية"], ["exams", "صفحة الاختبارات"], ["chat", "الدردشات"]].map(([t, label]) => (
                  <label key={t} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(editing.targets ?? []).includes(t)} onChange={() => toggleTarget(t)} />{label}</label>
                ))}
              </div>
              {(options?.sections.length ?? 0) > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">أقسام معينة</div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {options!.sections.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(editing.targets ?? []).includes(`section:${s.id}`)} onChange={() => toggleTarget(`section:${s.id}`)} />{s.name}</label>
                    ))}
                  </div>
                </div>
              )}
              {(options?.items.length ?? 0) > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">عناصر معينة</div>
                  <input className="input mb-2" placeholder="بحث في العناصر" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
                  <div className="max-h-40 overflow-y-auto chat-scroll grid gap-1">
                    {filteredItems.map((i) => (
                      <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(editing.targets ?? []).includes(`item:${i.id}`)} onChange={() => toggleTarget(`item:${i.id}`)} />{i.title}</label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Field>

          <Field label="مين يشوف الإعلان" locked={lk("audience")}>
            <select className="input mb-2" value={editing.audience ?? "everyone"} onChange={(e) => set({ audience: e.target.value as AnnouncementAdminRow["audience"] })}>
              <option value="everyone">الكل (حتى غير المسجّلين)</option>
              <option value="members">المسجّلين بس</option>
              <option value="ranks">أصحاب رتب معينة</option>
            </select>
            {editing.audience === "ranks" && (
              <div className="rounded-lg border border-border p-2 grid gap-1 max-h-40 overflow-y-auto">
                {(options?.ranks ?? []).map((r) => {
                  const on = (editing.rank_ids ?? []).includes(r.id);
                  return (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={on} onChange={() => set({ rank_ids: on ? (editing.rank_ids ?? []).filter((x) => x !== r.id) : [...(editing.rank_ids ?? []), r.id] })} />{r.name}
                    </label>
                  );
                })}
                {(options?.ranks.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">مفيش رتب لسه.</div>}
              </div>
            )}
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="اللون" locked={lk("style")}>
              <select className="input" value={editing.tone ?? "info"} onChange={(e) => set({ tone: e.target.value as AnnouncementAdminRow["tone"] })}>
                {Object.entries(TONE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="الترتيب (الأصغر الأول)" locked={lk("status")}>
              <input type="number" className="input" value={editing.sort_order ?? 0} onChange={(e) => set({ sort_order: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-4">
            <label className={`flex items-center gap-2 text-sm ${lk("style") ? "opacity-50" : ""}`}><input type="checkbox" disabled={lk("style")} checked={editing.open_by_default ?? false} onChange={(e) => set({ open_by_default: e.target.checked })} />يتفتح لوحده (من غير ما يدوس على السهم)</label>
            <label className={`flex items-center gap-2 text-sm ${lk("style") ? "opacity-50" : ""}`}><input type="checkbox" disabled={lk("style")} checked={editing.dismissible ?? true} onChange={(e) => set({ dismissible: e.target.checked })} />الشخص يقدر يقفله</label>
            <label className={`flex items-center gap-2 text-sm ${lk("status") ? "opacity-50" : ""}`}><input type="checkbox" disabled={lk("status")} checked={editing.enabled ?? true} onChange={(e) => set({ enabled: e.target.checked })} />شغال</label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="يبدأ من (اختياري)" locked={lk("schedule")}><input type="datetime-local" className="input" value={toLocalInput(editing.starts_at)} onChange={(e) => set({ starts_at: fromLocalInput(e.target.value) })} /></Field>
            <Field label="ينتهي في (اختياري)" locked={lk("schedule")}><input type="datetime-local" className="input" value={toLocalInput(editing.ends_at)} onChange={(e) => set({ ends_at: fromLocalInput(e.target.value) })} /></Field>
          </div>

          <div className="mb-6">
            <div className="text-sm text-muted-foreground mb-2">معاينة (كده هيظهر للزوار)</div>
            <AnnouncementCard
              key={`${editing.title}|${editing.image}|${editing.tone}|${editing.open_by_default}`}
              a={{
                id: "preview", title: editing.title || "عنوان الإعلان", body: editing.body ?? "", link_url: editing.link_url || null, link_label: editing.link_label || null,
                image: editing.image ?? null, tone: editing.tone ?? "info", open_by_default: editing.open_by_default ?? false, dismissible: false, updated_at: "",
              }}
            />
          </div>

          <button onClick={save} disabled={uploading} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-50"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}
