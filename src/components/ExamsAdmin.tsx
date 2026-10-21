// لوحة تحكم الاختبارات: الاختبارات + بنك الأسئلة + التسليمات + المحظورين
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, Edit3, Save, ListChecks, Link2, Eye, EyeOff, Search, Unlock, RotateCcw, FileText, ArrowRight, Layers, ClipboardCheck, CheckCircle2, XCircle,
} from "lucide-react";
import {
  adminExamsFn, adminSaveExamFn, adminDeleteExamFn,
  adminQuestionsFn, adminSaveQuestionFn, adminDeleteQuestionsFn, adminBulkQuestionsFn,
  adminAttemptsFn, adminAttemptFn, adminGradeAttemptFn, adminUnblockFn, adminRetakeFn, adminDeleteAttemptsFn,
} from "@/lib/exam-fns";
import { BypassPicker } from "@/components/BypassPicker";
import type { AdminExam, AdminAttemptRow, Question, QType, QKind, ImageMode } from "@/lib/exams.server";
import { Field, Modal } from "@/components/admin-ui";
import { useMe } from "@/lib/use-me";

const examsQuery = { queryKey: ["admin-exams"], queryFn: () => adminExamsFn() };
const attemptsQuery = { queryKey: ["admin-attempts"], queryFn: () => adminAttemptsFn(), refetchInterval: 5000 };

const typeLabel: Record<QType, string> = { choice: "اختيارات", short: "إجابة قصيرة", long: "إجابة طويلة" };
const statusLabel: Record<string, string> = {
  in_progress: "جارية", submitted: "مُسلَّمة", blocked: "محظور", unblocked: "اتفك حظره", retired: "سُمح بمحاولة جديدة",
};
const blockReasonLabel: Record<string, string> = {
  leave: "ريفريش أو خروج", tab_switch: "تبديل تاب", reentry: "دخول تاني أثناء محاولة جارية",
};
const submitReasonLabel: Record<string, string> = {
  manual: "سلّم بنفسه", attempt_timer: "خلص وقته الشخصي", exam_timer: "خلص وقت الاختبار العام",
};

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "medium" }) : "—";
}
// <input type="datetime-local"> <-> ISO
function isoToLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ============================== الاختبارات ==============================

export function ExamsAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  // الحقل مقفول لو الاختبار موجود والشخص ملوش صلاحية تعديل المجموعة دي
  const lk = (g: string) => !!editing?.id && !can(`exams.manage.settings.${g}`, { exam: editing.id });
  const { data: exams = [], refetch } = useQuery(examsQuery);
  const [editing, setEditing] = useState<Partial<AdminExam> | null>(null);
  const [questionsFor, setQuestionsFor] = useState<AdminExam | null>(null);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["public-exams"] }); };

  const openEdit = (e: Partial<AdminExam>) => {
    setEditing(e);
  };

  const save = async () => {
    if (!editing) return;
    try {
      await adminSaveExamFn({
        data: {
          id: editing.id,
          title: editing.title,
          description: editing.description ?? "",
          published: editing.published ?? false,
          grading: editing.grading ?? "manual",
          optional_count: Number(editing.optional_count) || 0,
          shuffle: editing.shuffle ?? true,
          attempt_minutes: editing.attempt_minutes ? Number(editing.attempt_minutes) : null,
          ends_at: editing.ends_at ?? null,
          block_on_tab_switch: editing.block_on_tab_switch ?? false,
          intro_message: editing.intro_message ?? "",
          submit_message: editing.submit_message ?? "",
          timeout_message: editing.timeout_message ?? "",
          block_message: editing.block_message ?? "",
          closed_message: editing.closed_message ?? "",
          access: editing.access ?? "open",
          password: editing.password ?? null,
          bypass: (editing.access ?? "open") !== "open" ? (editing.bypass ?? null) : null,
        },
      });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ");
    setEditing(null);
    refresh();
  };

  const del = async (id: string) => {
    if (!confirm("حذف الاختبار بكل أسئلته وتسليماته؟ مينفعش تتراجع.")) return;
    try { await adminDeleteExamFn({ data: id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف");
    refresh();
  };

  const togglePublish = async (e: AdminExam) => {
    try { await adminSaveExamFn({ data: { id: e.id, title: e.title, published: !e.published } }); }
    catch (err: any) { return toast.error(err.message || "حدث خطأ"); }
    refresh();
  };

  const copyLink = async (id: string) => {
    const url = `${location.origin}/exams/${id}`;
    try { await navigator.clipboard.writeText(url); toast.success("تم نسخ الرابط"); } catch { toast.message(url); }
  };

  if (questionsFor) {
    const fresh = exams.find((e) => e.id === questionsFor.id) ?? questionsFor;
    return <QuestionsAdmin exam={fresh} onBack={() => { setQuestionsFor(null); refresh(); }} />;
  }

  return (
    <div>
      {can("exams.create") && <button onClick={() => openEdit({ published: false, shuffle: true, optional_count: 0 })} className="btn-gold ripple mb-6 inline-flex items-center gap-2">
        <Plus className="h-4 w-4" />اختبار جديد
      </button>}

      <div className="grid gap-3">
        {exams.length === 0 && <div className="text-muted-foreground text-sm">مفيش اختبارات لسه.</div>}
        {exams.map((e) => (
          <div key={e.id} className="mil-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-48">
                <div className="font-bold">{e.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {e.published ? "منشور" : "مسودة"}{e.access === "locked" ? " • 🔒 مقفول بكلمة سر" : e.access === "hidden" ? " • 🕶 مشفّر (مخفي)" : ""} • أساسي {e.core_count} • اختياري {e.optional_count_pool} (بيتسحب {e.optional_count} لكل شخص)
                  {e.attempt_minutes ? ` • ${e.attempt_minutes} دقيقة` : ""}
                  {e.ends_at ? ` • ينتهي ${fmt(e.ends_at)}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  جارية {e.attempts.in_progress} • مُسلَّمة {e.attempts.submitted} • محظور {e.attempts.blocked}
                </div>
              </div>
              {e.can && Object.values(e.can.questions).some(Boolean) && <button onClick={() => setQuestionsFor(e)} className="px-3 py-1.5 rounded-md border border-border hover:border-[var(--gold)] text-sm inline-flex items-center gap-2">
                <ListChecks className="h-4 w-4" />الأسئلة
              </button>}
              <button onClick={() => copyLink(e.id)} title="نسخ الرابط" className="p-2 hover:text-[var(--gold)]"><Link2 className="h-4 w-4" /></button>
              {e.can?.settings.publish && <button onClick={() => togglePublish(e)} title={e.published ? "إخفاء" : "نشر"} className="p-2 hover:text-[var(--gold)]">
                {e.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>}
              {e.can?.anySettings && <button onClick={() => openEdit(e)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
              {e.can?.delete && <button onClick={() => del(e.id)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <Modal wide onClose={() => setEditing(null)} title={editing.id ? "تعديل اختبار" : "اختبار جديد"}>
          <Field label="عنوان الاختبار" locked={lk("title")}>
            <input className="input" value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </Field>
          <Field label="وصف (اختياري — بيظهر في قايمة الاختبارات)" locked={lk("description")}>
            <textarea className="input min-h-20" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </Field>
          <Field label="رسالة قبل البدء (اختياري)" locked={lk("description")}>
            <textarea className="input min-h-20" value={editing.intro_message ?? ""} onChange={(e) => setEditing({ ...editing, intro_message: e.target.value })} />
          </Field>

          <div className="grid md:grid-cols-3 gap-4">
            <Field locked={lk("limits")} label="الأسئلة الاختيارية لكل شخص" hint="كام سؤال بيتسحب عشوائي من البنك الاختياري">
              <input type="number" min={0} className="input" value={editing.optional_count ?? 0} onChange={(e) => setEditing({ ...editing, optional_count: parseInt(e.target.value) || 0 })} />
            </Field>
            <Field locked={lk("limits")} label="تايمر المحاولة (دقيقة)" hint="من لحظة ما الشخص يفتح الاختبار. فاضي = بدون">
              <input type="number" min={1} className="input" value={editing.attempt_minutes ?? ""} onChange={(e) => setEditing({ ...editing, attempt_minutes: e.target.value ? parseInt(e.target.value) : null })} />
            </Field>
            <Field locked={lk("limits")} label="تايمر الاختبار العام (ينتهي في)" hint="للكل مهما دخل في أي وقت. فاضي = بدون">
              <input type="datetime-local" className="input" dir="ltr" value={isoToLocalInput(editing.ends_at ?? null)} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </Field>
          </div>

          <Field label="طريقة التصحيح" locked={lk("grading")} hint="الدرجة النهائية = مجموع درجات الأسئلة (كل سؤال له درجته في بنك الأسئلة). الاختبار للمسجّلين بس وبيانات الطالب بتتاخد من حسابه.">
            <select className="input" value={editing.grading ?? "manual"} onChange={(e) => setEditing({ ...editing, grading: e.target.value as "manual" | "auto" })}>
              <option value="manual">يدوي — أنا بصحّح كل الأسئلة وأحدد درجتها</option>
              <option value="auto">تلقائي — الاختيارات بتتصحح لوحدها حسب الإجابة الصح اللي أحددها، والنصي بصححه أنا</option>
            </select>
          </Field>

          <div className="flex flex-wrap gap-6 mb-4">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={lk("publish")} checked={editing.published ?? false} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />منشور</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={lk("options")} checked={editing.shuffle ?? true} onChange={(e) => setEditing({ ...editing, shuffle: e.target.checked })} />ترتيب الأسئلة والاختيارات عشوائي</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={lk("options")} checked={editing.block_on_tab_switch ?? false} onChange={(e) => setEditing({ ...editing, block_on_tab_switch: e.target.checked })} />حظر لو بدّل التاب</label>
          </div>

          <div className="rounded-lg border border-border p-4 mb-4">
            <Field label="نوع الاختبار" locked={lk("access")}>
              <select className="input" value={editing.access ?? "open"} onChange={(e) => setEditing({ ...editing, access: e.target.value as AdminExam["access"] })}>
                <option value="open">مفتوح — يظهر للكل ويدخله أي حد</option>
                <option value="locked">مقفول بكلمة سر — اسمه ظاهر في القايمة والدخول بكلمة سر</option>
                <option value="hidden">مشفّر — مخفي بالكامل (حتى اسمه) لحد ما الشخص يكتب كلمة السر</option>
              </select>
            </Field>
            {(editing.access ?? "open") !== "open" && (
              <Field label="كلمة سر الاختبار (4 أحرف على الأقل، ومينفعش تتكرر في اختبار تاني)" locked={lk("access")} hint={editing.access === "hidden" ? "المشفّر بيتفتح بكلمة السر لوحدها من صفحة الاختبارات، فشاركها مع اللي عايزهم يدخلوه بس." : undefined}>
                <input className="input" dir="ltr" value={editing.password ?? ""} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
              </Field>
            )}
            {(editing.access ?? "open") !== "open" && (
              <Field label="مين يدخل الاختبار من غير كلمة سر؟ (اختياري)" locked={lk("access")} hint={editing.access === "hidden" ? "المشفّر بيظهر في قايمة الاختبارات للمستثنين دول بس." : undefined}>
                <BypassPicker value={editing.bypass} onChange={(b) => setEditing({ ...editing, bypass: b })} />
              </Field>
            )}
          </div>

          <Field label="رسالة التسليم" locked={lk("messages")}>
            <textarea className="input min-h-20" value={editing.submit_message ?? ""} onChange={(e) => setEditing({ ...editing, submit_message: e.target.value })} />
          </Field>
          <Field label="رسالة انتهاء الوقت (فاضية = نفس رسالة التسليم)" locked={lk("messages")}>
            <textarea className="input min-h-20" value={editing.timeout_message ?? ""} onChange={(e) => setEditing({ ...editing, timeout_message: e.target.value })} />
          </Field>
          <Field label="رسالة الحظر (الكود بيظهر تحتها أوتوماتيك)" locked={lk("messages")}>
            <textarea className="input min-h-20" value={editing.block_message ?? ""} onChange={(e) => setEditing({ ...editing, block_message: e.target.value })} />
          </Field>
          <Field label="رسالة لو الاختبار انتهى قبل ما الشخص يبدأ" locked={lk("messages")}>
            <textarea className="input min-h-20" value={editing.closed_message ?? ""} onChange={(e) => setEditing({ ...editing, closed_message: e.target.value })} />
          </Field>

          <button onClick={save} className="btn-gold ripple mt-2 inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}

// ============================== بنك الأسئلة ==============================

function QuestionsAdmin({ exam, onBack }: { exam: AdminExam; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: questions = [], refetch } = useQuery({
    queryKey: ["admin-questions", exam.id],
    queryFn: () => adminQuestionsFn({ data: exam.id }),
  });
  const [filter, setFilter] = useState<"all" | QKind>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Question> | null>(null);
  const [optionsText, setOptionsText] = useState("");
  const [bulk, setBulk] = useState<{ kind: QKind; defaultType: "short" | "long"; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-exams"] }); };

  const core = questions.filter((q) => q.kind === "core").length;
  const opt = questions.filter((q) => q.kind === "optional").length;
  const shown = useMemo(
    () => questions.filter((q) => (filter === "all" || q.kind === filter) && (!search.trim() || q.text.includes(search.trim()))),
    [questions, filter, search],
  );

  const openEdit = (q: Partial<Question>) => {
    setEditing(q);
    setOptionsText((q.options ?? []).join("\n"));
  };

  const save = async () => {
    if (!editing) return;
    try {
      await adminSaveQuestionFn({
        data: {
          id: editing.id, exam_id: exam.id,
          kind: editing.kind ?? "core", type: editing.type ?? "choice",
          text: editing.text ?? "",
          options: optionsText.split("\n").map((s) => s.trim()).filter(Boolean),
          image_mode: editing.image_mode ?? "none",
          max_images: editing.max_images ?? 3,
          model_answer: editing.model_answer ?? null,
          points: editing.points ?? 1,
          correct_answer: (editing.type ?? "choice") === "choice" ? (editing.correct_answer ?? null) : null,
        },
      });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ");
    setEditing(null);
    refresh();
  };

  const saveBulk = async () => {
    if (!bulk) return;
    try {
      const r = await adminBulkQuestionsFn({ data: { examId: exam.id, ...bulk } });
      toast.success(`اتضاف ${r.added} سؤال`);
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    setBulk(null);
    refresh();
  };

  const delSelected = async () => {
    if (!selected.size || !confirm(`حذف ${selected.size} سؤال؟`)) return;
    try { await adminDeleteQuestionsFn({ data: [...selected] }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    setSelected(new Set());
    refresh();
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const perPerson = core + Math.min(exam.optional_count, opt);
  const qp = exam.can?.questions ?? { view: false, add: false, edit: false, delete: false };

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-sm text-muted-foreground hover:text-[var(--gold)] inline-flex items-center gap-1"><ArrowRight className="h-4 w-4" />رجوع للاختبارات</button>
      <h2 className="text-2xl font-bold gold-text mb-1">{exam.title}</h2>
      <div className="text-sm text-muted-foreground mb-2">
        أساسي {core} • اختياري {opt} • كل شخص هياخد {perPerson} سؤال ({core} أساسي + {Math.min(exam.optional_count, opt)} اختياري)
      </div>
      {exam.optional_count > opt && (
        <div className="text-sm text-destructive mb-2">تنبيه: المطلوب سحب {exam.optional_count} اختياري بس البنك فيه {opt} بس.</div>
      )}

      <div className="flex flex-wrap items-center gap-2 my-4">
        {qp.add && <button onClick={() => openEdit({ kind: "core", type: "choice" })} className="btn-gold ripple inline-flex items-center gap-2"><Plus className="h-4 w-4" />سؤال</button>}
        {qp.add && <button onClick={() => setBulk({ kind: "optional", defaultType: "short", text: "" })} className="px-4 py-2 rounded-md border border-border hover:border-[var(--gold)] inline-flex items-center gap-2"><Layers className="h-4 w-4" />إضافة جماعية</button>}
        {qp.delete && selected.size > 0 && (
          <button onClick={delSelected} className="px-4 py-2 rounded-md border border-destructive text-destructive inline-flex items-center gap-2"><Trash2 className="h-4 w-4" />حذف المحدد ({selected.size})</button>
        )}
        <div className="mr-auto flex items-center gap-2">
          <select className="input !w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">الكل</option>
            <option value="core">الأساسي</option>
            <option value="optional">الاختياري</option>
          </select>
          <div className="relative">
            <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="input !pr-9" placeholder="بحث" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        {shown.length === 0 && <div className="text-muted-foreground text-sm">مفيش أسئلة.</div>}
        {shown.map((q) => (
          <div key={q.id} className="mil-card p-3 flex items-start gap-3">
            {qp.delete ? <input type="checkbox" className="mt-1.5" checked={selected.has(q.id)} onChange={() => toggle(q.id)} /> : <span className="w-4" />}
            <div className="flex-1 min-w-0">
              <div className="whitespace-pre-wrap">{q.text}</div>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                <span className={q.kind === "core" ? "text-[var(--gold)]" : ""}>{q.kind === "core" ? "أساسي" : "اختياري"}</span>
                <span>{typeLabel[q.type]}</span>
                {q.type === "choice" && <span>{q.options.length} اختيارات</span>}
                <span>{q.points} درجة</span>
                {q.type === "choice" && (q.correct_answer ? <span className="text-emerald-500">له إجابة صح</span> : exam.grading === "auto" ? <span className="text-destructive">من غير إجابة صح</span> : null)}
                {q.model_answer && <span>له إجابة نموذجية</span>}
                {q.image_mode && q.image_mode !== "none" && <span className="text-[var(--gold)]">صورة {q.image_mode === "required" ? "إجبارية" : "اختيارية"} (حتى {q.max_images})</span>}
              </div>
            </div>
            {qp.edit && <button onClick={() => openEdit(q)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
            {qp.delete && <button onClick={async () => { if (!confirm("حذف السؤال؟")) return; await adminDeleteQuestionsFn({ data: [q.id] }); refresh(); }} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>

      {editing && (
        <Modal wide onClose={() => setEditing(null)} title={editing.id ? "تعديل سؤال" : "سؤال جديد"}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="النوع">
              <select className="input" value={editing.kind ?? "core"} onChange={(e) => setEditing({ ...editing, kind: e.target.value as QKind })}>
                <option value="core">أساسي (يظهر للكل)</option>
                <option value="optional">اختياري (يتسحب عشوائي)</option>
              </select>
            </Field>
            <Field label="شكل الإجابة">
              <select className="input" value={editing.type ?? "choice"} onChange={(e) => setEditing({ ...editing, type: e.target.value as QType })}>
                <option value="choice">اختيارات</option>
                <option value="short">إجابة قصيرة</option>
                <option value="long">إجابة طويلة</option>
              </select>
            </Field>
          </div>
          <Field label="نص السؤال">
            <textarea className="input min-h-24" value={editing.text ?? ""} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
          </Field>
          {(editing.type ?? "choice") === "choice" && (
            <Field label="الاختيارات (سطر لكل اختيار)">
              <textarea className="input min-h-28" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="درجة السؤال" hint="تتجمع كلها في الدرجة النهائية">
              <input type="number" min={0} step="any" className="input" dir="ltr" value={editing.points ?? 1} onChange={(e) => setEditing({ ...editing, points: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
            {(editing.type ?? "choice") === "choice" && (
              <Field label="الإجابة الصح (للتصحيح التلقائي)">
                <select className="input" value={editing.correct_answer ?? ""} onChange={(e) => setEditing({ ...editing, correct_answer: e.target.value || null })}>
                  <option value="">— مفيش —</option>
                  {optionsText.split("\n").map((o) => o.trim()).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="صورة في الإجابة">
              <select className="input" value={editing.image_mode ?? "none"} onChange={(e) => setEditing({ ...editing, image_mode: e.target.value as ImageMode })}>
                <option value="none">من غير صور</option>
                <option value="optional">يقدر يرفق صور (اختياري)</option>
                <option value="required">لازم يرفق صورة (إجباري)</option>
              </select>
            </Field>
            {(editing.image_mode ?? "none") !== "none" && (
              <Field label="أقصى عدد صور">
                <input type="number" min={1} max={10} className="input" value={editing.max_images ?? 3} onChange={(e) => setEditing({ ...editing, max_images: Number(e.target.value) })} />
              </Field>
            )}
          </div>
          <Field label="إجابة نموذجية (اختياري — تظهر لك بس وقت المراجعة)">
            <textarea className="input min-h-20" value={editing.model_answer ?? ""} onChange={(e) => setEditing({ ...editing, model_answer: e.target.value })} />
          </Field>
          <button onClick={save} className="btn-gold ripple inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}

      {bulk && (
        <Modal wide onClose={() => setBulk(null)} title="إضافة أسئلة جماعية">
          <div className="grid grid-cols-2 gap-4">
            <Field label="تضيفهم كـ">
              <select className="input" value={bulk.kind} onChange={(e) => setBulk({ ...bulk, kind: e.target.value as QKind })}>
                <option value="optional">اختياري</option>
                <option value="core">أساسي</option>
              </select>
            </Field>
            <Field label="الأسئلة اللي من غير اختيارات تبقى">
              <select className="input" value={bulk.defaultType} onChange={(e) => setBulk({ ...bulk, defaultType: e.target.value as "short" | "long" })}>
                <option value="short">إجابة قصيرة</option>
                <option value="long">إجابة طويلة</option>
              </select>
            </Field>
          </div>
          <div className="text-xs text-muted-foreground mb-2 leading-loose">
            افصل بين كل سؤال والتاني بسطر فاضي. أي سطر بيبدأ بـ ‎-‎ بيتحسب اختيار (لازم اختيارين على الأقل عشان السؤال يبقى اختيارات). ابدأ سطر الإجابة الصح بـ ‎+‎ بدل ‎-‎. كل سؤال بياخد درجة 1 وتقدر تعدّلها بعدين.
          </div>
          <textarea
            className="input min-h-72 font-mono text-sm"
            placeholder={"ما هي رتبة ...؟\n- نقيب\n- رائد\n- مقدم\n\nاشرح خطوات ..."}
            value={bulk.text}
            onChange={(e) => setBulk({ ...bulk, text: e.target.value })}
          />
          <button onClick={saveBulk} className="btn-gold ripple mt-4 inline-flex items-center gap-2"><Plus className="h-4 w-4" />إضافة</button>
        </Modal>
      )}
    </div>
  );
}

// ============================== التسليمات ==============================

export function SubmissionsAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const { data: attempts = [], refetch } = useQuery(attemptsQuery);
  const { data: exams = [] } = useQuery(examsQuery);
  const [examId, setExamId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [viewId, setViewId] = useState<string | null>(null);

  const rows = attempts.filter((a) => can("exams.review.view", { exam: a.exam_id }) &&
    (!examId || a.exam_id === examId) &&
    (!status || a.status === status) &&
    (!search.trim() || (a.identity + " " + Object.values(a.fields).join(" ") + " " + (a.block_code ?? "")).toLowerCase().includes(search.trim().toLowerCase())),
  );

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-exams"] }); };

  const retake = async (id: string) => {
    if (!confirm("السماح للشخص ده بمحاولة جديدة؟ التسليم القديم هيفضل محفوظ.")) return;
    await adminRetakeFn({ data: [id] });
    toast.success("اتسمح بمحاولة جديدة");
    refresh();
  };
  const del = async (id: string) => {
    if (!confirm("حذف المحاولة نهائيًا؟")) return;
    await adminDeleteAttemptsFn({ data: [id] });
    refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <select className="input !w-auto" value={examId} onChange={(e) => setExamId(e.target.value)}>
          <option value="">كل الاختبارات</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input !pr-9" placeholder="بحث بالاسم أو الكود" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="mr-auto text-sm text-muted-foreground self-center">{rows.length} محاولة</div>
      </div>

      <div className="grid gap-2">
        {rows.length === 0 && <div className="text-muted-foreground text-sm">مفيش محاولات.</div>}
        {rows.map((a) => (
          <AttemptRow key={a.id} a={a}>
            {(a.status === "submitted" || a.status === "retired") && can("exams.review.grade", { exam: a.exam_id }) ? (
              <button onClick={() => setViewId(a.id)} className="px-3 py-1.5 rounded-md border border-[var(--gold)] text-[var(--gold)] text-sm inline-flex items-center gap-2"><ClipboardCheck className="h-4 w-4" />تصحيح</button>
            ) : (
              <button onClick={() => setViewId(a.id)} className="px-3 py-1.5 rounded-md border border-border hover:border-[var(--gold)] text-sm inline-flex items-center gap-2"><FileText className="h-4 w-4" />الإجابات</button>
            )}
            {a.status === "submitted" && can("exams.unblock", { exam: a.exam_id }) && (
              <button onClick={() => retake(a.id)} title="السماح بمحاولة جديدة" className="p-2 hover:text-[var(--gold)]"><RotateCcw className="h-4 w-4" /></button>
            )}
            {can("exams.review.delete", { exam: a.exam_id }) && <button onClick={() => del(a.id)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </AttemptRow>
        ))}
      </div>

      {viewId && <AttemptModal id={viewId} canGrade={can("exams.review.grade", { exam: attempts.find((a) => a.id === viewId)?.exam_id ?? "" })} onClose={() => { setViewId(null); refresh(); }} />}
    </div>
  );
}

function AttemptRow({ a, children }: { a: AdminAttemptRow; children?: React.ReactNode }) {
  return (
    <div className="mil-card p-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-56">
        <div className="font-bold">{Object.values(a.fields).join(" — ")}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {a.exam_title} • محاولة {a.attempt_no} • {(a.status === "submitted" || a.status === "retired") && (a.graded ? <span className="text-emerald-500 font-bold">{a.score}/{a.max} </span> : <span className="text-amber-500">لسه مصححش • </span>)}<span className={a.status === "blocked" ? "text-destructive" : a.status === "submitted" ? "text-[var(--gold)]" : ""}>{statusLabel[a.status]}</span>
          {a.block_code && <> • <span dir="ltr" className="font-mono">{a.block_code}</span></>}
        </div>
        <div className="text-xs text-muted-foreground">
          جاوب {a.answered}/{a.total} • بدأ {fmt(a.started_at)}
          {a.submitted_at && ` • سلّم ${fmt(a.submitted_at)}${a.submit_reason ? ` (${submitReasonLabel[a.submit_reason]})` : ""}`}
          {a.status === "in_progress" && ` • آخر ظهور ${fmt(a.last_seen_at)}`}
        </div>
      </div>
      {children}
    </div>
  );
}

function AttemptModal({ id, canGrade, onClose }: { id: string; canGrade: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-attempt", id], queryFn: () => adminAttemptFn({ data: id }) });
  const [scores, setScores] = useState<Record<string, string>>({});
  const [fbs, setFbs] = useState<Record<string, string>>({});
  const [init, setInit] = useState(false);
  const [saving, setSaving] = useState(false);

  // نبدأ بالدرجات الحالية (اليدوية أو التلقائية)
  if (data && !init) {
    const o: Record<string, string> = {};
    for (const it of data.items) if (it.score !== null) o[it.id] = String(it.score);
    setScores(o);
    setFbs(Object.fromEntries(data.items.filter((it) => it.feedback).map((it) => [it.id, it.feedback])));
    setInit(true);
  }

  const gradable = !!data && canGrade && (data.attempt.status === "submitted" || data.attempt.status === "retired");
  const total = data ? Math.round(data.items.reduce((s, it) => s + (Number(scores[it.id]) || 0), 0) * 100) / 100 : 0;
  const max = data ? Math.round(data.items.reduce((s, it) => s + it.points, 0) * 100) / 100 : 0;

  const save = async () => {
    if (!data) return;
    for (const it of data.items) {
      const v = scores[it.id];
      if (v !== undefined && v !== "" && (Number(v) < 0 || Number(v) > it.points)) return toast.error(`درجة السؤال لازم بين 0 و ${it.points}`);
    }
    for (const [i, it] of data.items.entries()) {
      const v = scores[it.id];
      const sc = v === undefined || v === "" ? (it.score ?? 0) : Number(v);
      const autoOk = it.auto && v === undefined;
      if (sc < it.points && !autoOk && !(fbs[it.id] ?? "").trim() && !(it.type === "choice" && it.auto && it.correct_answer)) {
        return toast.error(`اكتب الإجابة الصح للسؤال ${i + 1} (درجته أقل من الكاملة)`);
      }
    }
    setSaving(true);
    try {
      const r = await adminGradeAttemptFn({ data: { id, scores, feedback: fbs } });
      toast.success(`اتحفظ التصحيح: ${r.total}/${r.max}`);
      qc.invalidateQueries({ queryKey: ["admin-attempt", id] });
      qc.invalidateQueries({ queryKey: ["admin-attempts"] });
      onClose();
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); } finally { setSaving(false); }
  };

  return (
    <Modal wide onClose={onClose} title={gradable ? "تصحيح المحاولة" : "إجابات المحاولة"}>
      {isLoading && <div className="text-muted-foreground">جارٍ التحميل...</div>}
      {data && (
        <div>
          <div className="text-sm text-muted-foreground mb-2">
            {data.exam_title} • {Object.entries(data.attempt.fields).map(([k, v]) => `${k}: ${v}`).join(" • ")}
          </div>
          <div className="text-sm mb-4">
            الدرجة: <span className="font-black text-[var(--gold)] text-lg" dir="ltr">{total} / {max}</span>
            <span className="text-xs text-muted-foreground mr-3">{data.grading === "auto" ? "تصحيح تلقائي للاختيارات" : "تصحيح يدوي"}</span>
          </div>
          <div className="space-y-4">
            {data.items.map((it, i) => (
              <div key={it.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  <div className="font-semibold mb-2 whitespace-pre-wrap flex-1">{i + 1}. {it.text}</div>
                  {gradable ? (
                    <label className="shrink-0 text-xs text-muted-foreground flex items-center gap-1" dir="ltr">
                      <input
                        type="number" min={0} max={it.points} step="any" className="input !w-20 !py-1 text-center"
                        value={scores[it.id] ?? ""} placeholder="—"
                        onChange={(e) => setScores({ ...scores, [it.id]: e.target.value })}
                      />/ {it.points}
                    </label>
                  ) : (
                    <div className="shrink-0 text-sm font-bold" dir="ltr">{it.score ?? "—"} / {it.points}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mb-2">{typeLabel[it.type]}{it.kind ? ` • ${it.kind === "core" ? "أساسي" : "اختياري"}` : ""}{it.auto ? " • اتصحح تلقائي" : ""}</div>
                <div className={`whitespace-pre-wrap rounded-md p-3 ${it.answer.trim() ? "bg-white/5" : "bg-destructive/10 text-destructive text-sm"}`}>
                  {it.answer.trim() || (it.images.length ? "(من غير نص — في صور)" : "(من غير إجابة)")}
                </div>
                {gradable && (() => {
                  const v = scores[it.id];
                  const sc = v === undefined || v === "" ? (it.score ?? 0) : Number(v);
                  const autoWrong = it.auto && it.type === "choice" && !!it.correct_answer;
                  if (sc >= it.points || autoWrong) return null;
                  return (
                    <div className="mt-3">
                      <label className="text-xs text-destructive block mb-1">الدرجة أقل من الكاملة — اكتب الإجابة الصح (بتظهر للطالب) *</label>
                      <textarea className="input min-h-16" value={fbs[it.id] ?? ""} onChange={(e) => setFbs({ ...fbs, [it.id]: e.target.value })} />
                    </div>
                  );
                })()}
                {!gradable && it.feedback && <div className="mt-2 text-sm text-emerald-500 whitespace-pre-wrap">الإجابة الصح المكتوبة للطالب: {it.feedback}</div>}
                {it.type === "choice" && it.correct_answer && (
                  <div className={`mt-2 text-sm flex items-center gap-1 ${it.answer.trim() === it.correct_answer ? "text-emerald-500" : "text-destructive"}`}>
                    {it.answer.trim() === it.correct_answer ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    الإجابة الصح: {it.correct_answer}
                  </div>
                )}
                {it.images.length > 0 && (
                  <div className="flex flex-wrap gap-3 mt-3">
                    {it.images.map((n) => (
                      <a key={n} href={`/api/exam-image/${n}`} target="_blank" rel="noreferrer" title="فتح بالحجم الكامل">
                        <img src={`/api/exam-image/${n}`} alt="" className="h-40 max-w-72 rounded-lg border border-border object-contain bg-black/20" />
                      </a>
                    ))}
                  </div>
                )}
                {it.image_mode === "required" && it.images.length === 0 && (
                  <div className="mt-2 text-xs text-destructive">السؤال ده كان بيطلب صورة ومتسلّمش فيه صور.</div>
                )}
                {it.model_answer && (
                  <div className="mt-2 text-sm text-[var(--gold)] whitespace-pre-wrap">الإجابة النموذجية: {it.model_answer}</div>
                )}
              </div>
            ))}
          </div>
          {gradable && (
            <div className="mt-5">
              <button onClick={save} disabled={saving} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-60"><Save className="h-4 w-4" />حفظ التصحيح</button>
              <div className="text-xs text-muted-foreground mt-2">الأسئلة اللي من غير درجة بتتحسب صفر. بعد الحفظ النتيجة بتظهر للطالب في «نتائج اختباراتي».</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ============================== المحظورين ==============================

export function useBlockedCount() {
  const { can, canAny } = useMe();
  const { data = [] } = useQuery({ ...attemptsQuery, enabled: canAny("exams.unblock") });
  return data.filter((a) => a.status === "blocked" && can("exams.unblock", { exam: a.exam_id })).length;
}

export function BlockedAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const { data: attempts = [], refetch } = useQuery(attemptsQuery);
  const { data: exams = [] } = useQuery(examsQuery);
  const [search, setSearch] = useState("");
  const [examId, setExamId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const blocked = attempts.filter((a) => a.status === "blocked" && can("exams.unblock", { exam: a.exam_id }));
  const q = search.trim().toLowerCase();
  const rows = blocked.filter((a) =>
    (!examId || a.exam_id === examId) &&
    (!q || (a.block_code ?? "").toLowerCase().includes(q) || a.identity.includes(q) || Object.values(a.fields).join(" ").toLowerCase().includes(q)),
  );

  const unblock = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const r = await adminUnblockFn({ data: ids });
      toast.success(`اتفك الحظر عن ${r.count}`);
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    setSelected(new Set());
    refetch();
    qc.invalidateQueries({ queryKey: ["admin-exams"] });
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // لو كتبت كود كامل وفي نتيجة واحدة بس، Enter يفك الحظر فورًا
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && rows.length === 1) unblock([rows[0].id]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input dir="auto" className="input !pr-9 min-w-64" placeholder="ابحث بكود الحظر أو الاسم  (Enter = فك لو نتيجة واحدة)" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onEnter} autoFocus />
        </div>
        <select className="input !w-auto" value={examId} onChange={(e) => setExamId(e.target.value)}>
          <option value="">كل الاختبارات</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} />تحديد الكل
        </label>
        {selected.size > 0 && (
          <button onClick={() => unblock([...selected])} className="btn-gold ripple inline-flex items-center gap-2"><Unlock className="h-4 w-4" />فك الحظر عن المحدد ({selected.size})</button>
        )}
        <div className="mr-auto text-sm text-muted-foreground">{rows.length} محظور</div>
      </div>

      <div className="grid gap-2">
        {rows.length === 0 && <div className="text-muted-foreground text-sm">مفيش محظورين حاليًا.</div>}
        {rows.map((a) => (
          <div key={a.id} className="mil-card p-3 flex flex-wrap items-center gap-3">
            <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
            <div dir="ltr" className="font-mono font-black text-lg text-destructive tracking-widest w-28">{a.block_code}</div>
            <div className="flex-1 min-w-56">
              <div className="font-bold">{Object.values(a.fields).join(" — ")}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {a.exam_title} • {a.block_reason ? blockReasonLabel[a.block_reason] : ""} • {fmt(a.blocked_at)} • جاوب {a.answered}/{a.total}
              </div>
            </div>
            <button onClick={() => unblock([a.id])} className="btn-gold ripple inline-flex items-center gap-2 !py-1.5 !px-4 text-sm"><Unlock className="h-4 w-4" />فك الحظر</button>
          </div>
        ))}
      </div>
    </div>
  );
}
