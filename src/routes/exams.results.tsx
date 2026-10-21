import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Award, CheckCircle2, ChevronDown, Hourglass, MinusCircle, XCircle } from "lucide-react";
import { myExamResultsFn } from "@/lib/exam-fns";
import { useMe } from "@/lib/use-me";
import type { MyResult } from "@/lib/exams.server";

export const Route = createFileRoute("/exams/results")({
  head: () => ({ meta: [{ title: "نتائج اختباراتي — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: ResultsPage,
});

// ألوان ونصوص كل مستوى: كاملة (أخضر) • فوق النص (أصفر مخضر) • النص (أصفر ذهبي) • تحت النص (أصفر محمر) • صفر (أحمر)
const V: Record<MyResult["items"][number]["verdict"], { label: string; box: string; text: string }> = {
  correct: { label: "إجابة صحيحة", box: "border-emerald-500/40 bg-emerald-500/5", text: "text-emerald-500" },
  above: { label: "إجابة مقبولة لكن غير دقيقة", box: "border-lime-500/50 bg-lime-500/10", text: "text-lime-500" },
  half: { label: "إجابة شبه مقبولة لكن غير دقيقة", box: "border-yellow-500/50 bg-yellow-500/10", text: "text-yellow-500" },
  below: { label: "إجابة غير مقبولة لكن أقرب من الإجابة الصحيحة", box: "border-orange-500/50 bg-orange-500/10", text: "text-orange-500" },
  wrong: { label: "إجابة خاطئة", box: "border-destructive/40 bg-destructive/5", text: "text-destructive" },
};

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "");
const num = (n: number) => String(Math.round(n * 100) / 100);

function ResultsPage() {
  const navigate = useNavigate();
  const { me, loading } = useMe();
  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);
  const { data, isLoading } = useQuery({
    queryKey: ["my-exam-results", me?.id ?? null],
    queryFn: () => myExamResultsFn(),
    enabled: !!me,
    refetchInterval: 30_000,
  });
  if (loading || !me) return <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-8 pb-6 border-b border-border">
          <Link to="/exams" className="text-sm text-muted-foreground hover:text-[var(--gold)] inline-flex items-center gap-1 mb-2"><ArrowRight className="h-3.5 w-3.5" />الاختبارات</Link>
          <h1 className="text-4xl font-black gold-text flex items-center gap-3"><Award className="h-8 w-8" />نتائج اختباراتي</h1>
        </div>
      </motion.div>

      {isLoading && <div className="text-center text-muted-foreground py-12">جارٍ التحميل...</div>}
      {!isLoading && !data?.length && <div className="text-center text-muted-foreground py-12">لسه ماسلّمتش أي اختبار.</div>}
      <div className="grid gap-4">{data?.map((r) => <ResultCard key={r.attempt_id} r={r} />)}</div>
    </div>
  );
}

function ResultCard({ r }: { r: MyResult }) {
  const [open, setOpen] = useState(false);
  const pct = r.graded && r.total !== null && r.max > 0 ? Math.round((r.total / r.max) * 100) : null;
  return (
    <div className="mil-card p-5">
      <button className="w-full flex items-center gap-4 text-right" onClick={() => r.graded && setOpen((v) => !v)} disabled={!r.graded}>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-lg">{r.exam_title}</div>
          <div className="text-xs text-muted-foreground mt-1">المحاولة {r.attempt_no} · سُلّمت {fmtDate(r.submitted_at)}</div>
        </div>
        {r.graded ? (
          <div className="text-left shrink-0">
            <div className="text-2xl font-black text-[var(--gold)]" dir="ltr">{num(r.total ?? 0)} / {num(r.max)}</div>
            {pct !== null && <div className="text-xs text-muted-foreground text-center">{pct}%</div>}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground shrink-0"><Hourglass className="h-4 w-4" />في انتظار التصحيح</span>
        )}
        {r.graded && <ChevronDown className={`h-5 w-5 shrink-0 transition ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && (
        <div className="mt-5 space-y-3 border-t border-border pt-5">
          {r.items.map((it, i) => (
            <div key={it.id} className={`rounded-lg border p-4 ${V[it.verdict].box}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {it.verdict === "correct" ? <CheckCircle2 className={`h-5 w-5 ${V.correct.text}`} /> : it.verdict === "wrong" ? <XCircle className={`h-5 w-5 ${V.wrong.text}`} /> : <MinusCircle className={`h-5 w-5 ${V[it.verdict].text}`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground mb-1">سؤال {i + 1}</div>
                  <div className="whitespace-pre-wrap leading-loose">{it.text}</div>
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">إجابتك: </span>
                    <span className="whitespace-pre-wrap break-words">{it.answer.trim() || "— لم تُجب —"}</span>
                  </div>
                </div>
                <div className="text-sm font-bold shrink-0" dir="ltr">{num(it.score)} / {num(it.max)}</div>
              </div>
              <div className={`text-xs mt-2 mr-8 font-bold ${V[it.verdict].text}`}>{V[it.verdict].label}</div>
              {it.feedback && (
                <div className="mt-3 mr-8 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-3 text-sm">
                  <div className="text-xs text-[var(--gold)] font-bold mb-1">الإجابة الصحيحة</div>
                  <div className="whitespace-pre-wrap leading-loose">{it.feedback}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
