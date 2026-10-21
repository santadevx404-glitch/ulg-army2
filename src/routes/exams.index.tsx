import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ClipboardList, Clock, CalendarX, ArrowLeft, Lock, KeyRound, Award } from "lucide-react";
import { publicExamsFn, unlockByPasswordFn } from "@/lib/exam-fns";
import { useMe } from "@/lib/use-me";

export const Route = createFileRoute("/exams/")({
  head: () => ({
    meta: [{ title: "الاختبارات — حرس الحدود" }, { name: "description", content: "الاختبارات المتاحة." }],
  }),
  component: ExamsIndex,
});

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}

/** كلمة سر لوحدها بتفتح الاختبار المشفّر (اللي اسمه مش ظاهر في القايمة). */
function SecretCodeBox() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await unlockByPasswordFn({ data: { password: pw.trim() } });
      if (r.state === "ok") {
        try { sessionStorage.setItem(`examAccess:${r.examId}`, r.token); } catch { /* ignore */ }
        return navigate({ to: "/exams/$id", params: { id: r.examId } });
      }
      setErr(r.state === "limited" ? "محاولات كتير، استنى دقيقة وجرّب تاني" : "مفيش اختبار بكلمة السر دي");
    } catch {
      setErr("حصل خطأ، حاول تاني");
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="mil-card p-5 mb-8">
      <div className="flex items-center gap-2 font-bold mb-1"><KeyRound className="h-4 w-4 text-[var(--gold)]" />عندك كلمة سر اختبار؟</div>
      <p className="text-xs text-muted-foreground mb-3">بعض الاختبارات مش بتظهر في القايمة. اكتب كلمة السر اللي اتبعتتلك عشان تفتحه.</p>
      <div className="flex gap-2">
        <input type="password" dir="ltr" className="input flex-1" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="كلمة السر" />
        <button type="submit" disabled={busy} className="btn-gold ripple disabled:opacity-50">{busy ? "..." : "فتح"}</button>
      </div>
      {err && <div className="text-sm text-destructive mt-2">{err}</div>}
    </form>
  );
}

function ExamsIndex() {
  const { me, loading } = useMe();
  // القايمة ظاهرة للكل، لكن فتح أي اختبار محتاج تسجيل دخول
  const { data: exams, isLoading } = useQuery({
    queryKey: ["public-exams", me?.id ?? null],
    queryFn: () => publicExamsFn(),
    enabled: !loading,
  });

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div className="mb-10 pb-6 border-b border-border">
          <div className="text-sm text-muted-foreground mb-2">حرس الحدود</div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-4xl md:text-5xl font-black gold-text">الاختبارات</h1>
            {me && <Link to="/exams/results" className="btn-gold ripple inline-flex items-center gap-2"><Award className="h-4 w-4" />نتائج اختباراتي</Link>}
          </div>
        </div>
      </motion.div>

      <SecretCodeBox />

      {isLoading && <div className="text-center text-muted-foreground py-16">جارٍ التحميل...</div>}
      {!isLoading && !exams?.length && (
        <div className="text-center text-muted-foreground py-16">لا توجد اختبارات متاحة حاليًا.</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {exams?.map((e, i) => (
          <motion.div key={e.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Link to="/exams/$id" params={{ id: e.id }} className="mil-card p-6 block h-full">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 rounded-lg bg-[var(--gold)]/15 text-[var(--gold)] shrink-0">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-bold leading-snug flex-1">{e.title}</h2>
                {e.locked && <span className="inline-flex items-center gap-1 text-xs text-[var(--gold)] shrink-0" title="محتاج كلمة سر"><Lock className="h-3.5 w-3.5" />كلمة سر</span>}
              </div>
              {e.description && <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{e.description}</p>}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {e.attempt_minutes && (
                  <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{e.attempt_minutes} دقيقة</span>
                )}
                {e.ends_at && (
                  <span className="inline-flex items-center gap-1"><CalendarX className="h-3.5 w-3.5" />ينتهي {formatDate(e.ends_at)}</span>
                )}
                {e.closed && <span className="px-2 py-0.5 rounded bg-destructive/20 text-destructive">منتهي</span>}
                <span className="mr-auto inline-flex items-center gap-1 text-[var(--gold)]">دخول<ArrowLeft className="h-3.5 w-3.5" /></span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
