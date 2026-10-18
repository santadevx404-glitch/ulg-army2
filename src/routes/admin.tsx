import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Plus, Trash2, Edit3, Eye, EyeOff, Upload, X, Save, ShieldAlert, ChevronDown, Bold, Underline } from "lucide-react";
import {
  saveSectionFn,
  deleteSectionFn,
  saveItemFn,
  deleteItemFn,
  toggleItemPublishedFn,
  uploadFileFn,
  saveTopicFn,
  deleteTopicFn,
} from "@/lib/server-fns";
import { ExamsAdmin, SubmissionsAdmin, BlockedAdmin, useBlockedCount } from "@/components/ExamsAdmin";
import { RequestsAdmin, MembersAdmin, RanksAdmin, LogAdmin, usePendingRequestsCount } from "@/components/AccountsAdmin";
import { ChatsAdmin } from "@/components/ChatsAdmin";
import { StorageStatus } from "@/components/StorageStatus";
import { AnnouncementsAdmin } from "@/components/AnnouncementsAdmin";
import { useMe } from "@/lib/use-me";
import { TAB_LABELS, type TabId } from "@/lib/permissions";
import { allSectionsAdminQuery, adminItemsQuery, topicsByItemAdminQuery, type Section, type Item, type Topic } from "@/lib/queries";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "لوحة التحكم — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const { me, loading } = useMe();
  const [tab, setTab] = useState<TabId | null>(null);
  const blockedCount = useBlockedCount();
  const requestsCount = usePendingRequestsCount();

  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);

  if (loading || !me) return <div className="p-16 text-center text-muted-foreground">جارٍ التحقق...</div>;

  const tabs = me.tabs as TabId[];
  if (tabs.length === 0) return (
    <div className="p-16 text-center max-w-lg mx-auto">
      <ShieldAlert className="h-12 w-12 mx-auto text-[var(--gold)] mb-4" />
      <h1 className="text-2xl font-bold gold-text mb-2">مفيش حاجة متاحة ليك في لوحة التحكم</h1>
      <p className="text-muted-foreground text-sm mb-6">لسه محدش دّاك صلاحيات. لما الإدارة تدّيك رتبة أو صلاحيات هتلاقيها هنا.</p>
      <Link to="/profile" className="btn-gold ripple inline-block">حسابي</Link>
    </div>
  );
  const active: TabId = tab && tabs.includes(tab) ? tab : tabs[0];

  return (
    <div className="max-w-7xl mx-auto p-6 md:p-10 admin-selectable">
      <div className="flex items-center gap-4 flex-wrap mb-6">
        <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-black gold-text">
          لوحة التحكم
        </motion.h1>
        {me.owner && <StorageStatus />}
      </div>

      <div className="flex flex-wrap gap-2 mb-6 border-b border-border">
        {tabs.map((t) => {
          const badge = t === "blocked" ? blockedCount : t === "requests" ? requestsCount : 0;
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3 font-semibold transition inline-flex items-center gap-2 ${active === t ? "text-[var(--gold)] border-b-2 border-[var(--gold)]" : "text-muted-foreground hover:text-foreground"}`}>
              {TAB_LABELS[t]}
              {badge > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-destructive text-white text-xs font-bold inline-flex items-center justify-center">{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {active === "sections" && <SectionsAdmin />}
      {active === "items" && <ItemsAdmin />}
      {active === "exams" && <ExamsAdmin />}
      {active === "submissions" && <SubmissionsAdmin />}
      {active === "blocked" && <BlockedAdmin />}
      {active === "chats" && <ChatsAdmin />}
      {active === "announcements" && <AnnouncementsAdmin />}
      {active === "requests" && <RequestsAdmin />}
      {active === "members" && <MembersAdmin />}
      {active === "ranks" && <RanksAdmin />}
      {active === "log" && <LogAdmin />}
    </div>
  );
}

// ============ SECTIONS ADMIN ============

function SectionsAdmin() {
  const qc = useQueryClient();
  const { can, canAnyAt: access } = useMe();
  // الحقل مقفول لو القسم موجود والشخص ملوش صلاحية تعديل الحقل ده
  const lk = (g: string) => !!editing?.id && !can(`sections.edit.${g}`, { section: editing.id });
  const { data: sections = [], refetch } = useQuery(allSectionsAdminQuery);
  const [editing, setEditing] = useState<Partial<Section> | null>(null);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["sections"] }); };

  const save = async () => {
    if (!editing?.name || !editing?.slug) { toast.error("الاسم والمُعرِّف مطلوبان"); return; }
    const payload: Partial<Section> = {
      id: editing.id,
      name: editing.name, slug: editing.slug,
      icon: editing.icon || null,
      sort_order: editing.sort_order ?? 0,
      visible: editing.visible ?? true,
      password: editing.password?.trim() ? editing.password.trim() : null,
    };
    try {
      await saveSectionFn({ data: payload });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ");
    setEditing(null); refresh();
  };

  const del = async (id: string) => {
    if (!confirm("حذف القسم وكل عناصره؟")) return;
    try {
      await deleteSectionFn({ data: id });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };

  return (
    <div>
      {can("sections.create") && (
        <button onClick={() => setEditing({ visible: true, sort_order: sections.length + 1 })} className="btn-gold ripple mb-6 inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />قسم جديد
        </button>
      )}

      <div className="grid gap-3">
        {sections.map((s) => (
          <div key={s.id} className="mil-card p-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="font-bold">{s.name}</div>
              <div className="text-xs text-muted-foreground">/{s.slug} • ترتيب {s.sort_order} • {s.visible ? "مرئي" : "مخفي"}{s.password ? " • 🔒 مقفول بكلمة سر" : ""}</div>
            </div>
            {access("sections.edit", { section: s.id }) && <button onClick={() => setEditing(s)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
            {can("sections.delete", { section: s.id }) && <button onClick={() => del(s.id)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "تعديل قسم" : "قسم جديد"}>
          <Field label="الاسم" locked={lk("name")}><input className="input" value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="المُعرِّف (بالإنجليزية، بدون مسافات)" locked={lk("slug")}>
            <input className="input" dir="ltr" value={editing.slug || ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
          </Field>
          <Field label="الأيقونة (Award / Crosshair / Truck / GraduationCap / MapPin / Shield)" locked={lk("icon")}>
            <input className="input" dir="ltr" value={editing.icon || ""} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
          </Field>
          <Field label="ترتيب" locked={lk("order")}><input type="number" className="input" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} /></Field>
          <label className="flex items-center gap-2 mt-2">
            <input type="checkbox" disabled={lk("visibility")} checked={editing.visible ?? true} onChange={(e) => setEditing({ ...editing, visible: e.target.checked })} />
            مرئي في السايدبار
          </label>
          <Field label="كلمة سر القسم (اختياري — سيبها فاضية لإلغاء القفل)" locked={lk("password")}>
            <input className="input" dir="ltr" type="text" value={editing.password || ""} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder="مثال: 1234" />
          </Field>
          <button onClick={save} className="btn-gold ripple mt-6 inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}

// ============ ITEMS ADMIN ============

function ItemsAdmin() {
  const qc = useQueryClient();
  const { can, canAnyAt: access } = useMe();
  const lk = (g: string) => !!editing?.id && !can(`items.edit.${g}`, { section: editing.section_id, item: editing.id });
  const { data: sections = [] } = useQuery(allSectionsAdminQuery);
  const { data: items = [], refetch } = useQuery(adminItemsQuery);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["section"] }); qc.invalidateQueries({ queryKey: ["item"] }); };
  const filtered = filter === "all" ? items : items.filter((i) => i.section_id === filter);
  // الأقسام اللي يقدر يضيف فيها عناصر
  const creatableSections = sections.filter((s) => can("items.create", { section: s.id }));

  const uploadFiles = async (files: FileList | null): Promise<string[]> => {
    if (!files || files.length === 0) return [];
    setUploading(true);
    const urls: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);
        const { url } = await uploadFileFn({ data: formData });
        urls.push(url);
      }
    } catch (e: any) { toast.error(e.message || "فشل رفع الصورة"); }
    finally { setUploading(false); }
    return urls;
  };

  const save = async () => {
    if (!editing?.title || !editing?.section_id) { toast.error("العنوان والقسم مطلوبان"); return; }
    const payload: Partial<Item> = {
      id: editing.id,
      section_id: editing.section_id,
      title: editing.title,
      short_description: editing.short_description || null,
      full_description: editing.full_description || null,
      cover_image: editing.cover_image || null,
      gallery: editing.gallery ?? [],
      published: editing.published ?? true,
      sort_order: editing.sort_order ?? 0,
      use_topics: editing.use_topics ?? false,
      password: editing.password?.trim() ? editing.password.trim() : null,
    };
    try {
      await saveItemFn({ data: payload });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ"); setEditing(null); refresh();
  };

  const del = async (id: string) => {
    if (!confirm("حذف العنصر؟")) return;
    try {
      await deleteItemFn({ data: id });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };

  const togglePub = async (it: Item) => {
    try {
      await toggleItemPublishedFn({ data: { id: it.id, published: !it.published } });
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); return; }
    refresh();
  };

  return (
    <div>
      <div className="flex gap-3 mb-6 items-center flex-wrap">
        {creatableSections.length > 0 && (
          <button onClick={() => setEditing({ published: true, gallery: [], section_id: creatableSections[0]?.id })} className="btn-gold ripple inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />عنصر جديد
          </button>
        )}
        <select className="input max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الأقسام</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="grid gap-3">
        {filtered.map((it) => {
          const section = sections.find((s) => s.id === it.section_id);
          return (
            <div key={it.id} className="mil-card p-4 flex items-center gap-4">
              {it.cover_image && <img src={it.cover_image} alt="" className="w-16 h-16 object-cover rounded" />}
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">{it.title}</div>
                <div className="text-xs text-muted-foreground">{section?.name} • {it.gallery.length + (it.cover_image ? 1 : 0)} صورة</div>
              </div>
              {access("items.edit", { section: it.section_id, item: it.id }) && (
                <>
                  {can("items.edit.published", { section: it.section_id, item: it.id }) && <button onClick={() => togglePub(it)} className="p-2" title={it.published ? "منشور" : "مخفي"}>
                    {it.published ? <Eye className="h-4 w-4 text-[var(--gold)]" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  </button>}
                  <button onClick={() => setEditing(it)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>
                </>
              )}
              {can("items.delete", { section: it.section_id, item: it.id }) && <button onClick={() => del(it.id)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-muted-foreground py-12">لا يوجد عناصر.</div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "تعديل عنصر" : "عنصر جديد"} wide>
          <Field label="القسم" locked={lk("section")}>
            <select className="input" value={editing.section_id || ""} onChange={(e) => setEditing({ ...editing, section_id: e.target.value })}>
              <option value="">— اختر —</option>
              {sections.filter((s) => s.id === editing.section_id || can("items.create", { section: s.id })).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="العنوان" locked={lk("title")}><input className="input" value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <Field label="وصف مختصر" locked={lk("short_description")}><textarea className="input" rows={2} value={editing.short_description || ""} onChange={(e) => setEditing({ ...editing, short_description: e.target.value })} /></Field>
          <Field label="وصف كامل" locked={lk("full_description")}><textarea className="input" rows={6} value={editing.full_description || ""} onChange={(e) => setEditing({ ...editing, full_description: e.target.value })} /></Field>

          <Field label="صورة الغلاف" locked={lk("cover")}>
            <div className="flex items-center gap-3 flex-wrap">
              {editing.cover_image && <img src={editing.cover_image} alt="" className="h-16 w-16 object-cover rounded" />}
              <label className="btn-gold ripple cursor-pointer inline-flex items-center gap-2">
                <Upload className="h-4 w-4" />رفع
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const urls = await uploadFiles(e.target.files); if (urls[0]) setEditing({ ...editing, cover_image: urls[0] });
                }} />
              </label>
              {editing.cover_image && <button onClick={() => setEditing({ ...editing, cover_image: null })} className="text-sm text-destructive">إزالة</button>}
            </div>
          </Field>

          <Field label="معرض الصور (تقدر تحط تسمية توضيحية تحت كل صورة)" locked={lk("gallery")}>
            <div className="flex flex-wrap gap-3 mb-2">
              {(editing.gallery ?? []).map((g, i) => (
                <div key={g.url + i} className="relative w-28">
                  <img src={g.url} alt="" className="h-20 w-28 object-cover rounded" />
                  <button onClick={() => setEditing({ ...editing, gallery: (editing.gallery ?? []).filter((_, j) => j !== i) })}
                    className="absolute -top-2 -right-2 bg-destructive rounded-full p-1"><X className="h-3 w-3" /></button>
                  <input
                    className="input text-xs mt-1 px-2 py-1"
                    placeholder="تسمية توضيحية..."
                    value={g.caption}
                    onChange={(e) => {
                      const gallery = [...(editing.gallery ?? [])];
                      gallery[i] = { ...gallery[i], caption: e.target.value };
                      setEditing({ ...editing, gallery });
                    }}
                  />
                </div>
              ))}
            </div>
            <label className="btn-gold ripple cursor-pointer inline-flex items-center gap-2">
              <Upload className="h-4 w-4" />إضافة صور (متعددة)
              <input type="file" multiple accept="image/*" className="hidden" onChange={async (e) => {
                const urls = await uploadFiles(e.target.files);
                const newImgs = urls.map((url) => ({ url, caption: "" }));
                setEditing({ ...editing, gallery: [...(editing.gallery ?? []), ...newImgs] });
              }} />
            </label>
            {uploading && <div className="text-sm text-muted-foreground mt-2">جارٍ الرفع...</div>}
          </Field>

          <div className="flex items-center gap-6 mt-4 flex-wrap">
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={lk("published")} checked={editing.published ?? true} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />منشور
            </label>
            <Field label="ترتيب" locked={lk("order")}><input type="number" className="input w-24" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: parseInt(e.target.value) || 0 })} /></Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={lk("topics_mode")} checked={editing.use_topics ?? false} onChange={(e) => setEditing({ ...editing, use_topics: e.target.checked })} />
              عرضه كقائمة مواضيع منسدلة (بدل صفحة التفاصيل العادية)
            </label>
          </div>

          <Field label="كلمة سر العنصر (اختياري — سيبها فاضية لإلغاء القفل)" locked={lk("password")}>
            <input className="input" dir="ltr" type="text" value={editing.password || ""} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder="مثال: 1234" />
          </Field>

          {editing.id && editing.use_topics && (
            <TopicsEditor itemId={editing.id} sectionId={editing.section_id} />
          )}

          {!editing.id && editing.use_topics && (
            <div className="mt-6 text-sm text-muted-foreground bg-muted/30 border border-border rounded-lg p-3">
              احفظ العنصر الأول، بعدين افتحه تاني عشان تقدر تضيفله المواضيع.
            </div>
          )}

          <button onClick={save} disabled={uploading} className="btn-gold ripple mt-6 inline-flex items-center gap-2 disabled:opacity-50">
            <Save className="h-4 w-4" />حفظ
          </button>
        </Modal>
      )}
    </div>
  );
}

// ============ TOPICS EDITOR (لقسم الدورات) ============

function TopicsEditor({ itemId, sectionId }: { itemId: string; sectionId?: string }) {
  const qc = useQueryClient();
  const { can, canAnyAt } = useMe();
  const scope = { section: sectionId, item: itemId };
  // حقل الموضوع مقفول لو الموضوع موجود والشخص ملوش صلاحية تعديله
  const tl = (g: string) => !!editingTopic?.id && !can(`items.topics.edit.${g}`, scope);
  const { data: topics = [], refetch } = useQuery(topicsByItemAdminQuery(itemId));
  const [editingTopic, setEditingTopic] = useState<Partial<Topic> | null>(null);
  const [uploadingTopicImg, setUploadingTopicImg] = useState(false);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["topics"] }); };

  const uploadTopicImages = async (files: FileList | null): Promise<string[]> => {
    if (!files || files.length === 0) return [];
    setUploadingTopicImg(true);
    const urls: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);
        const { url } = await uploadFileFn({ data: formData });
        urls.push(url);
      }
    } catch (e: any) { toast.error(e.message || "فشل رفع الصورة"); }
    finally { setUploadingTopicImg(false); }
    return urls;
  };

  const saveTopic = async () => {
    if (!editingTopic?.title?.trim()) { toast.error("عنوان الموضوع مطلوب"); return; }
    try {
      await saveTopicFn({
        data: {
          id: editingTopic.id,
          item_id: itemId,
          title: editingTopic.title,
          content: editingTopic.content || "",
          images: editingTopic.images ?? [],
          sort_order: editingTopic.sort_order ?? topics.length + 1,
        },
      });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ"); setEditingTopic(null); refresh();
  };

  const delTopic = async (id: string) => {
    if (!confirm("حذف الموضوع؟")) return;
    try { await deleteTopicFn({ data: id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold gold-text">مواضيع الدورة</h3>
        {can("items.topics.create", scope) && (
          <button
            onClick={() => setEditingTopic({ sort_order: topics.length + 1 })}
            className="btn-gold ripple text-sm inline-flex items-center gap-2 px-3 py-1.5"
          >
            <Plus className="h-4 w-4" />موضوع جديد
          </button>
        )}
      </div>

      <div className="grid gap-2">
        {topics.map((t) => (
          <div key={t.id} className="mil-card p-3 flex items-center gap-3">
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0 font-semibold truncate">{t.title}</div>
            {canAnyAt("items.topics.edit", scope) && <button onClick={() => setEditingTopic(t)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
            {can("items.topics.delete", scope) && <button onClick={() => delTopic(t.id)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {topics.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">لا توجد مواضيع بعد.</div>}
      </div>

      {editingTopic && (
        <Modal onClose={() => setEditingTopic(null)} title={editingTopic.id ? "تعديل موضوع" : "موضوع جديد"}>
          <Field label="عنوان الموضوع" locked={tl("title")}>
            <input className="input" value={editingTopic.title || ""} onChange={(e) => setEditingTopic({ ...editingTopic, title: e.target.value })} />
          </Field>
          <Field label="المحتوى" locked={tl("content")}>
            <textarea
              className="input"
              rows={8}
              value={editingTopic.content || ""}
              onChange={(e) => setEditingTopic({ ...editingTopic, content: e.target.value })}
              placeholder="اكتب محتوى الموضوع هنا..."
            />
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Underline className="h-3 w-3" />__نص__ = تسطير</span>
              <span className="inline-flex items-center gap-1"><Bold className="h-3 w-3" />**نص** = عريض</span>
              <span>**__نص__** = عريض + تسطير</span>
            </div>
          </Field>
          <Field label="صور الموضوع (اختياري — تقدر تحط تسمية توضيحية تحت كل صورة)" locked={tl("images")}>
            {(editingTopic.images?.length ?? 0) > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-2">
                {editingTopic.images!.map((img, i) => (
                  <div key={img.url + i} className="relative group">
                    <div className="relative aspect-square rounded overflow-hidden">
                      <img src={img.url} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setEditingTopic({ ...editingTopic, images: editingTopic.images!.filter((_, idx) => idx !== i) })}
                        className="absolute top-1 left-1 bg-black/60 rounded-full p-1 opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3 text-white" />
                      </button>
                    </div>
                    <input
                      className="input text-xs mt-1 px-2 py-1"
                      placeholder="تسمية توضيحية..."
                      value={img.caption}
                      onChange={(e) => {
                        const images = [...editingTopic.images!];
                        images[i] = { ...images[i], caption: e.target.value };
                        setEditingTopic({ ...editingTopic, images });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <label className="btn-gold ripple text-sm inline-flex items-center gap-2 px-3 py-1.5 cursor-pointer">
              <Upload className="h-4 w-4" />{uploadingTopicImg ? "جارٍ الرفع..." : "رفع صورة/صور"}
              <input
                type="file" accept="image/*" multiple className="hidden"
                onChange={async (e) => {
                  const urls = await uploadTopicImages(e.target.files);
                  const newImgs = urls.map((url) => ({ url, caption: "" }));
                  setEditingTopic({ ...editingTopic, images: [...(editingTopic.images || []), ...newImgs] });
                }}
              />
            </label>
          </Field>
          <Field label="ترتيب" locked={tl("order")}>
            <input type="number" className="input w-24" value={editingTopic.sort_order ?? 0} onChange={(e) => setEditingTopic({ ...editingTopic, sort_order: parseInt(e.target.value) || 0 })} />
          </Field>
          <button onClick={saveTopic} className="btn-gold ripple mt-4 inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children, locked }: { label: string; children: React.ReactNode; locked?: boolean }) {
  return (
    <div className="mb-4">
      <label className="text-sm mb-1 block text-muted-foreground">
        {label}
        {locked && <span className="mr-2 text-xs text-[var(--gold)]">🔒 مفيش صلاحية تعديل</span>}
      </label>
      {locked ? <fieldset disabled className="opacity-50 pointer-events-none">{children}</fieldset> : children}
    </div>
  );
}

function Modal({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={`mil-card p-6 w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-8`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gold-text">{title}</h2>
          <button onClick={onClose} className="p-1 hover:text-destructive"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
