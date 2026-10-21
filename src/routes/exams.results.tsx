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
            <div key={it.id} className={`rounded-lg border p-4 ${it.verdict === "correct" ? "border-emerald-500/40 bg-emerald-500/5" : it.verdict === "partial" ? "border-amber-500/40 bg-amber-500/5" : "border-destructive/40 bg-destructive/5"}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {it.verdict === "correct" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : it.verdict === "partial" ? <MinusCircle className="h-5 w-5 text-amber-500" /> : <XCircle className="h-5 w-5 text-destructive" />}
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
              <div className="text-xs mt-2 mr-8 text-muted-foreground">
                {it.verdict === "correct" ? "إجابة صحيحة" : it.verdict === "partial" ? "إجابة جزئية" : "إجابة خاطئة"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
