import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Award, CheckCircle2, ChevronDown, Flag, Hourglass, MinusCircle, XCircle } from "lucide-react";
import { createGrievanceFn, myExamResultsFn } from "@/lib/exam-fns";
import { formatAnswer } from "@/lib/answer-format";
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
          <div className="text-xs text-muted-foreground mt-1">المحاولة {r.attempt_no} · سُلّمت {fmtDate(r.submitted_at)}{r.archived && <span className="mr-2 rounded-full border border-sky-400/50 text-sky-400 px-2 py-0.5">مؤرشف</span>}{r.grievances.some((g) => g.status === "open") && <span className="mr-2 rounded-full bg-amber-500 text-black px-2 py-0.5 font-bold">تظلم قيد المراجعة</span>}</div>
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
        <div className="mt-5 border-t border-border pt-5">
          <Summary r={r} />
          <GeneralGrievance r={r} />
          {r.view === "new" ? <NewReview r={r} items={r.items} /> : (
          <div className="space-y-3">
          {r.items.map((it, i) => <ItemBox key={it.id} it={it} i={i} r={r} />)}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  choice: "اختيار من متعدد", short: "إجابة قصيرة", long: "مقالي", tf: "صح أو خطأ", tf_fix: "صح/خطأ مع تصويب", fix: "صحّح المعلومة",
};

/** ملخص: الدرجة حسب نوع السؤال + الأسئلة اللي محتاجة مراجعة */
function Summary({ r }: { r: MyResult }) {
  const groups = new Map<string, { got: number; max: number }>();
  for (const it of r.items) {
    const g = groups.get(it.type) ?? { got: 0, max: 0 };
    g.got += it.score; g.max += it.max;
    groups.set(it.type, g);
  }
  const review = r.items.map((it, i) => ({ it, n: i + 1 })).filter(({ it }) => it.verdict !== "correct");
  return (
    <div className="mb-5 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border p-4">
        <div className="text-sm font-bold mb-3">الدرجة حسب نوع السؤال</div>
        <div className="space-y-2.5">
          {[...groups.entries()].map(([t, g]) => {
            const pc = g.max > 0 ? Math.round((g.got / g.max) * 100) : 0;
            return (
              <div key={t}>
                <div className="flex justify-between text-xs mb-1"><span>{TYPE_LABEL[t] ?? t}</span><span dir="ltr">{num(g.got)} / {num(g.max)}</span></div>
                <div className="h-2 rounded bg-border overflow-hidden"><div className={`h-full ${pc >= 100 ? "bg-emerald-500" : pc >= 50 ? "bg-yellow-500" : "bg-destructive"}`} style={{ width: `${pc}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-lg border border-border p-4">
        <div className="text-sm font-bold mb-3">أسئلة تراجعها {review.length > 0 && <span className="text-muted-foreground font-normal">({review.length})</span>}</div>
        {review.length === 0 ? (
          <div className="text-sm text-emerald-500">ممتاز — كل إجاباتك كاملة.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {review.map(({ it, n }) => (
              <span key={it.id} className={`h-8 min-w-8 px-2 rounded-full border text-sm font-bold inline-flex items-center justify-center ${V[it.verdict].box} ${V[it.verdict].text}`}>{n}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** مراجعة بالشكل الجديد: شريط أرقام ملوّن بالنتيجة + سؤال واحد */
function NewReview({ items, r }: { items: MyResult["items"]; r: MyResult }) {
  const [cur, setCur] = useState(0);
  const it = items[cur];
  if (!it) return null;
  return (
    <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-4">
      <div className="flex flex-wrap gap-2 content-start mb-4 lg:mb-0">
        {items.map((x, i) => (
          <button
            key={x.id} type="button" onClick={() => setCur(i)}
            className={`h-9 w-9 rounded-full border text-sm font-bold ${x.violation ? "border-2 border-destructive bg-destructive/10 text-destructive" : `${V[x.verdict].box} ${V[x.verdict].text}`} ${i === cur ? "ring-2 ring-[var(--gold)]" : ""}`}
          >{i + 1}</button>
        ))}
      </div>
      <div>
        <ItemBox it={it} i={cur} r={r} />
        <div className="mt-3 flex justify-between">
          <button type="button" disabled={cur === 0} onClick={() => setCur(cur - 1)} className="px-4 py-2 rounded-lg border border-border disabled:opacity-40">السابق</button>
          <button type="button" disabled={cur === items.length - 1} onClick={() => setCur(cur + 1)} className="px-4 py-2 rounded-lg border border-border disabled:opacity-40">التالي</button>
        </div>
      </div>
    </div>
  );
}

function ItemBox({ it, i, r }: { it: MyResult["items"][number]; i: number; r: MyResult }) {
  return (
    <div>
            <div className={`rounded-lg p-4 ${it.violation ? "border-2 border-destructive bg-destructive/5" : `border ${V[it.verdict].box}`}`}>
              {it.violation && (
                <div className="mb-3 rounded-md bg-destructive/15 px-3 py-2 text-sm font-bold text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {it.violation === "zeroed" ? "تم تصفير السؤال ده بسبب مخالفتك (تبديل التبويب أثناء الاختبار)." : "تم تغيير السؤال ده بسبب مخالفتك (تبديل التبويب أثناء الاختبار)."}
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {it.verdict === "correct" ? <CheckCircle2 className={`h-5 w-5 ${V.correct.text}`} /> : it.verdict === "wrong" ? <XCircle className={`h-5 w-5 ${V.wrong.text}`} /> : <MinusCircle className={`h-5 w-5 ${V[it.verdict].text}`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground mb-1">سؤال {i + 1}</div>
                  <div className="whitespace-pre-wrap leading-loose">{it.text}</div>
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">إجابتك: </span>
                    <span className="whitespace-pre-wrap break-words">{formatAnswer(it.type, it.answer) || "— لم تُجب —"}</span>
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
      <GrievanceBlock r={r} qid={it.id} />
    </div>
  );
}

const G_STATUS = { open: { label: "قيد المراجعة", cls: "bg-amber-500 text-black" }, accepted: { label: "تم قبول التظلم", cls: "bg-emerald-500/20 text-emerald-500" }, rejected: { label: "تم رفض التظلم", cls: "bg-destructive/20 text-destructive" } } as const;

/** تظلماتك على سؤال معيّن + زرار تظلم جديد */
function GrievanceBlock({ r, qid }: { r: MyResult; qid: string | null }) {
  const mine = r.grievances.filter((g) => g.qid === qid);
  const hasOpen = mine.some((g) => g.status === "open");
  return (
    <div className="mt-2">
      {mine.map((g) => (
        <div key={g.id} className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <Flag className="h-4 w-4 text-amber-500" /><b>تظلمك</b>
            <span className={`mr-auto text-xs px-2 py-0.5 rounded-full ${G_STATUS[g.status].cls}`}>{G_STATUS[g.status].label}</span>
          </div>
          <div className="whitespace-pre-wrap">{g.message}</div>
          {g.response && <div className="mt-2 rounded bg-white/5 p-2 whitespace-pre-wrap"><span className="text-xs text-[var(--gold)] font-bold">رد الإدارة: </span>{g.response}</div>}
        </div>
      ))}
      {!hasOpen && <GrievanceForm attemptId={r.attempt_id} qid={qid} />}
    </div>
  );
}

function GrievanceForm({ attemptId, qid }: { attemptId: string; qid: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await createGrievanceFn({ data: { attempt_id: attemptId, qid, message: msg } });
      toast.success("تم إرسال التظلم للإدارة");
      setMsg(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["my-exam-results"] });
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); } finally { setBusy(false); }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted-foreground hover:text-amber-500 inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5" />{qid ? "تظلم على هذا السؤال" : "تظلم عام على التسليم"}</button>;
  return (
    <div className="rounded-md border border-border p-3">
      <textarea className="input min-h-20 mb-2" maxLength={1500} placeholder="اشرح الغلط اللي شايفه في التصحيح..." value={msg} onChange={(e) => setMsg(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" onClick={send} disabled={busy || msg.trim().length < 3} className="btn-gold ripple !py-1.5 !px-4 text-sm disabled:opacity-50">{busy ? "جارٍ الإرسال..." : "إرسال التظلم"}</button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-md border border-border text-sm">إلغاء</button>
      </div>
    </div>
  );
}

function GeneralGrievance({ r }: { r: MyResult }) {
  return <div className="mb-4"><GrievanceBlock r={r} qid={null} /></div>;
}
