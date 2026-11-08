import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Clock, ImagePlus, Loader2, Lock, Send, ShieldAlert, Timer, X } from "lucide-react";
import { publicExamFn, startExamFn, pollExamFn, saveAnswersFn, unlockExamFn } from "@/lib/exam-fns";
import { useMe } from "@/lib/use-me";
import { TF_FALSE, TF_TRUE, buildFix, buildTfFix, parseFix, parseTfFix } from "@/lib/answer-format";
import type { PublicExamInfo, ServedQuestion, StartResult } from "@/lib/exams.server";

export const Route = createFileRoute("/exams/$id")({
  head: () => ({ meta: [{ title: "اختبار — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: ExamPage,
});

// نافذة اختيار الصورة بتخلّي المتصفح يفقد الفوكس — بنسمح بيها لحد 20 ثانية بس
let pickerUntil = 0;

type Started = Extract<StartResult, { state: "started" }>;

type Phase =
  | { k: "loading" }
  | { k: "missing" }
  | { k: "gate"; title: string | null }
  | { k: "intake" }
  | { k: "running"; data: Started }
  | { k: "blocked"; code: string; message: string }
  | { k: "done"; message: string }
  | { k: "closed"; message: string };

function ExamPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { me, loading: meLoading } = useMe();
  // الاختبارات للمسجّلين بس — بياناتك بتتاخد من حسابك
  useEffect(() => {
    if (!meLoading && !me) navigate({ to: "/auth" });
  }, [meLoading, me, navigate]);
  const [info, setInfo] = useState<PublicExamInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  // توكن فتح الاختبار المقفول/المشفّر (بيتحفظ لحد ما التاب يتقفل)
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  useEffect(() => {
    try { setToken(sessionStorage.getItem(`examAccess:${id}`)); } catch { /* ignore */ }
    setTokenLoaded(true);
  }, [id]);

  useEffect(() => {
    if (!tokenLoaded || !me) return;
    (async () => {
      const r = await publicExamFn({ data: { id, token } });
      if (r.state === "unavailable") return setPhase({ k: "missing" });
      if (r.state === "gate") {
        if (token) { try { sessionStorage.removeItem(`examAccess:${id}`); } catch { /* ignore */ } setToken(null); }
        return setPhase({ k: "gate", title: r.title });
      }
      // مستثنى من كلمة السر: السيرفر بيدّيه توكن الدخول من غير ما يكتب حاجة
      if (r.token && !token) {
        try { sessionStorage.setItem(`examAccess:${id}`, r.token); } catch { /* ignore */ }
        setToken(r.token);
      }
      setInfo(r.info);
      setPhase((p) => (p.k === "loading" || p.k === "gate" ? { k: "intake" } : p));
    })().catch(() => setPhase({ k: "missing" }));
  }, [id, token, tokenLoaded, me]);

  const applyResult = useCallback((r: StartResult) => {
    if (r.state === "error") return setError(r.error);
    if (r.state === "started") return setPhase({ k: "running", data: r });
    if (r.state === "blocked") return setPhase({ k: "blocked", code: r.code, message: r.message });
    if (r.state === "submitted") return setPhase({ k: "done", message: r.message });
    if (r.state === "closed") return setPhase({ k: "closed", message: r.message });
  }, []);

  const start = async () => {
    if (!info) return;
    setError("");
    setStarting(true);
    try {
      applyResult(await startExamFn({ data: { examId: id, access: token } }));
    } catch (e: any) {
      setError(e?.message || "حصل خطأ، حاول تاني");
    } finally {
      setStarting(false);
    }
  };

  if (meLoading || !me || phase.k === "loading") return <Centered><Loader2 className="h-6 w-6 animate-spin text-[var(--gold)]" /></Centered>;
  if (phase.k === "missing") {
    return (
      <Centered>
        <h1 className="text-2xl font-bold gold-text mb-3">الاختبار غير متاح</h1>
        <Link to="/exams" className="btn-gold inline-block ripple">كل الاختبارات</Link>
      </Centered>
    );
  }

  if (phase.k === "gate") {
    return (
      <PasswordGate
        examId={id}
        title={phase.title}
        onUnlocked={(t) => {
          try { sessionStorage.setItem(`examAccess:${id}`, t); } catch { /* ignore */ }
          setToken(t);
        }}
      />
    );
  }

  if (phase.k === "running") {
    return (
      <ExamRunner
        data={phase.data}
        onBlocked={(code, message) => setPhase({ k: "blocked", code, message })}
        onDone={(message) => setPhase({ k: "done", message })}
      />
    );
  }

  if (phase.k === "blocked") {
    return (
      <BlockedScreen
        examId={id}
        accessToken={token}
        code={phase.code}
        message={phase.message}
        onResult={applyResult}
      />
    );
  }

  if (phase.k === "done") {
    return (
      <Centered>
        <CheckCircle2 className="h-14 w-14 text-[var(--gold)] mx-auto mb-4" />
        <p className="text-lg leading-loose whitespace-pre-wrap">{phase.message}</p>
        <div className="flex flex-wrap justify-center gap-3 mt-8">
          <Link to="/exams" className="btn-gold inline-block ripple">كل الاختبارات</Link>
          <Link to="/exams/results" className="inline-block rounded-md border border-border px-4 py-2 hover:border-[var(--gold)] transition">نتائج اختباراتي</Link>
        </div>
      </Centered>
    );
  }

  if (phase.k === "closed") {
    return (
      <Centered>
        <Clock className="h-14 w-14 text-[var(--gold)] mx-auto mb-4" />
        <p className="text-lg leading-loose whitespace-pre-wrap">{phase.message}</p>
        <Link to="/exams" className="btn-gold inline-block ripple mt-8">كل الاختبارات</Link>
      </Centered>
    );
  }

  // ---- intake ----
  return (
    <div className="p-6 md:p-10 max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-8 pb-6 border-b border-border">
          <div className="text-sm text-muted-foreground mb-2">الاختبارات</div>
          <h1 className="text-3xl md:text-4xl font-black gold-text">{info!.title}</h1>
          {info!.description && <p className="mt-3 text-muted-foreground whitespace-pre-wrap">{info!.description}</p>}
        </div>

        {info!.intro_message && (
          <div className="rounded-xl border border-border bg-card/70 p-4 mb-6 whitespace-pre-wrap leading-loose">
            {info!.intro_message}
          </div>
        )}

        <div className="rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-4 mb-6 text-sm leading-loose">
          <div className="flex items-center gap-2 font-bold text-[var(--gold)] mb-1">
            <AlertTriangle className="h-4 w-4" />قبل ما تبدأ
          </div>
          <ul className="list-disc pr-5 space-y-1 text-foreground/90">
            <li>ممنوع تعمل ريفريش أو تقفل الصفحة أو تخرج من الاختبار — هيتم إيقافك فورًا.</li>
            <li>نسخ ولصق النص ممنوعين داخل الاختبار.</li>
            {info!.attempt_minutes && <li>مدة الاختبار {info!.attempt_minutes} دقيقة من لحظة ما تبدأ.</li>}
            {info!.ends_at && (
              <li>الاختبار بيقفل للكل في {new Date(info!.ends_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })} حتى لو لسه ماخلصتش.</li>
            )}
            <li>لما الوقت يخلص إجاباتك بتتسلم أوتوماتيك.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card/70 p-6">
          <div className="mb-4 text-sm leading-loose">
            <div className="text-muted-foreground mb-1">هتدخل الاختبار بحسابك:</div>
            <div className="font-bold">{me.character_name || me.account_name}</div>
            {me.account_name && me.character_name && <div className="text-xs text-muted-foreground">{me.account_name}</div>}
          </div>
          {error && <div className="text-sm text-destructive mb-3">{error}</div>}
          <button onClick={start} disabled={starting} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-60">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            ابدأ الاختبار
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-xl w-full text-center">{children}</div>
    </div>
  );
}

// ============================== شاشة الحظر ==============================

function BlockedScreen({
  examId, accessToken, code, message, onResult,
}: {
  examId: string;
  accessToken: string | null;
  code: string;
  message: string;
  onResult: (r: StartResult) => void;
}) {
  const [released, setReleased] = useState(false);
  const [starting, setStarting] = useState(false);

  // بنسأل السيرفر كل كام ثانية لو الأدمن فك الحظر
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await pollExamFn({ data: { examId, access: accessToken } });
        if (stop) return;
        if (r.state === "can_start") setReleased(true);
        else if (r.state === "submitted") onResult({ state: "submitted", message: r.message });
        else if (r.state === "closed") onResult({ state: "closed", message: r.message });
      } catch {
        /* ignore */
      }
    };
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [examId, accessToken, onResult]);

  const start = async () => {
    setStarting(true);
    try {
      onResult(await startExamFn({ data: { examId, access: accessToken } }));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Centered>
      {released ? (
        <>
          <CheckCircle2 className="h-14 w-14 text-[var(--gold)] mx-auto mb-4" />
          <h1 className="text-2xl font-bold gold-text mb-2">تم فك الحظر</h1>
          <p className="text-muted-foreground mb-6">هتبدأ الاختبار بأسئلة جديدة، والوقت بيبدأ من أول ما تضغط.</p>
          <button onClick={start} disabled={starting} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-60">
            {starting && <Loader2 className="h-4 w-4 animate-spin" />}ابدأ الاختبار
          </button>
        </>
      ) : (
        <>
          <ShieldAlert className="h-14 w-14 text-destructive mx-auto mb-4" />
          <p className="text-lg leading-loose whitespace-pre-wrap mb-6">{message}</p>
          <div className="inline-block rounded-xl border border-destructive/50 bg-destructive/10 px-8 py-4">
            <div className="text-xs text-muted-foreground mb-1">كود الحظر</div>
            <div dir="ltr" className="text-3xl font-black tracking-widest text-destructive select-all">{code}</div>
          </div>
          <p className="text-xs text-muted-foreground mt-6 flex items-center justify-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />الصفحة بتتحدّث لوحدها أول ما الحظر يتفك
          </p>
        </>
      )}
    </Centered>
  );
}

// ============================== الاختبار نفسه ==============================

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function PasswordGate({ examId, title, onUnlocked }: { examId: string; title: string | null; onUnlocked: (token: string) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await unlockExamFn({ data: { examId, password: pw.trim() } });
      if (r.state === "ok") return onUnlocked(r.token);
      setErr(r.state === "limited" ? "محاولات كتير، استنى دقيقة وجرّب تاني" : "كلمة السر غلط");
    } catch {
      setErr("حصل خطأ، حاول تاني");
    } finally { setBusy(false); }
  };

  return (
    <Centered>
      <form onSubmit={submit} className="max-w-sm mx-auto">
        <Lock className="h-12 w-12 text-[var(--gold)] mx-auto mb-4" />
        <h1 className="text-2xl font-bold gold-text mb-1">{title ?? "اختبار محمي بكلمة سر"}</h1>
        <p className="text-sm text-muted-foreground mb-5">اكتب كلمة السر عشان تدخل الاختبار.</p>
        <input type="password" dir="ltr" autoFocus className="input text-center mb-3" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="كلمة السر" />
        {err && <div className="text-sm text-destructive mb-3">{err}</div>}
        <button type="submit" disabled={busy} className="btn-gold ripple w-full disabled:opacity-50">{busy ? "..." : "دخول"}</button>
        <Link to="/exams" className="block text-sm text-muted-foreground hover:text-[var(--gold)] mt-5">كل الاختبارات</Link>
      </form>
    </Centered>
  );
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** بيجهّز الصورة للرفع: لو كبيرة بيصغّرها ويضغطها JPEG (أقصى ضلع 2000px) */
async function prepareImage(file: Blob): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("نوع الصورة مش مدعوم (JPG / PNG / WEBP / GIF)");
  if (file.size > 25 * 1024 * 1024) throw new Error("الصورة كبيرة جدًا");
  if (file.size <= 1_500_000) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.85, 0.7, 0.5]) {
    const out: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (out && out.size <= MAX_IMAGE_BYTES) return out;
  }
  throw new Error("الصورة أكبر من 4 ميجا حتى بعد الضغط");
}

function ExamRunner({
  data, onBlocked, onDone,
}: {
  data: Started;
  onBlocked: (code: string, message: string) => void;
  onDone: (message: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(data.answers ?? {});
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [images, setImages] = useState<Record<string, string[]>>({});
  const [imgBusy, setImgBusy] = useState<Record<string, boolean>>({});
  const [imgErr, setImgErr] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [submitError, setSubmitError] = useState("");
  const activeQidRef = useRef<string | null>(null);

  const answersRef = useRef(answers);
  const dirtyRef = useRef(false);
  const finishedRef = useRef(false); // السيرفر خلاص قفل المحاولة (تسليم/حظر) → مفيش beacon
  const leftRef = useRef(false); // اتبلّغ عن تبديل تاب
  const leftPendingRef = useRef(false); // خروج من النافذة لسه السيرفر ماأكدش حظره
  const mountedRef = useRef(true);
  const offsetRef = useRef(new Date(data.server_now).getTime() - Date.now());

  const serverNow = now + offsetRef.current;
  const personalEnd = data.attempt_deadline_at ? new Date(data.attempt_deadline_at).getTime() : null;
  const generalEnd = data.exam_ends_at ? new Date(data.exam_ends_at).getTime() : null;
  const personalLeft = personalEnd !== null ? personalEnd - serverNow : null;
  const generalLeft = generalEnd !== null ? generalEnd - serverNow : null;
  const expired = (personalLeft !== null && personalLeft <= 0) || (generalLeft !== null && generalLeft <= 0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const finish = useCallback((message: string) => {
    finishedRef.current = true;
    onDone(message);
  }, [onDone]);

  // نتائج أي نداء للسيرفر
  const handleServerState = useCallback((r: Awaited<ReturnType<typeof saveAnswersFn>>) => {
    if (r.state === "submitted") { finish(r.message); return true; }
    if (r.state === "blocked") {
      finishedRef.current = true;
      leftPendingRef.current = false;
      try { localStorage.removeItem(`exam-left-${data.attemptId}`); } catch { /* ignore */ }
      onBlocked(r.code, r.message);
      return true;
    }
    if (r.state === "invalid") { finishedRef.current = true; onDone("انتهت هذه المحاولة."); return true; }
    return false;
  }, [finish, onBlocked, onDone]);

  const save = useCallback(async (final = false) => {
    dirtyRef.current = false;
    return saveAnswersFn({
      data: { attemptId: data.attemptId, token: data.token, answers: answersRef.current, final, left: leftPendingRef.current },
    });
  }, [data.attemptId, data.token]);

  // حفظ تلقائي + نبض كل 4 ثواني
  useEffect(() => {
    const t = setInterval(async () => {
      if (finishedRef.current) return;
      try { handleServerState(await save()); } catch { dirtyRef.current = true; }
    }, 4000);
    return () => clearInterval(t);
  }, [save, handleServerState]);

  // الوقت خلص عندنا: نكرر الحفظ كل ثانية لحد ما السيرفر يأكد التسليم
  useEffect(() => {
    if (!expired || finishedRef.current) return;
    setSubmitting(true);
    let stop = false;
    const run = async () => {
      if (stop || finishedRef.current) return;
      try { if (handleServerState(await save())) return; } catch { /* retry */ }
      if (!stop) setTimeout(run, 1000);
    };
    run();
    return () => { stop = true; };
  }, [expired, save, handleServerState]);

  // ---- كشف الخروج / الريفريش ----
  useEffect(() => {
    mountedRef.current = true;

    const beacon = (reason: "leave" | "tab_switch") => {
      if (finishedRef.current) return;
      const body = JSON.stringify({
        attemptId: data.attemptId, token: data.token, reason, answers: answersRef.current,
      });
      try {
        if (!navigator.sendBeacon("/api/exam-leave", new Blob([body], { type: "text/plain" }))) throw new Error();
      } catch {
        fetch("/api/exam-leave", { method: "POST", body, keepalive: true }).catch(() => {});
      }
    };

    // أي خروج من النافذة بيتسجّل فورًا ومحليًا (حتى لو الشبكة واقعة أو البلاغ اتحجب)،
    // وبيتبعت مع كل نبضة لحد ما السيرفر يأكد الحظر.
    const storeKey = `exam-left-${data.attemptId}`;
    try { if (localStorage.getItem(storeKey)) leftPendingRef.current = true; } catch { /* ignore */ }
    const violation = () => {
      if (!data.block_on_tab_switch || finishedRef.current) return;
      leftRef.current = true;
      if (!leftPendingRef.current) {
        leftPendingRef.current = true;
        try { localStorage.setItem(storeKey, String(Date.now())); } catch { /* ignore */ }
        beacon("tab_switch");
      }
      // إعادة المحاولة فورًا من غير ما ننتظر النبضة الجاية
      void save().then(handleServerState).catch(() => {});
    };
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const lostFocus = () => {
      if (!data.block_on_tab_switch || finishedRef.current || blurTimer) return;
      if (Date.now() < pickerUntil) return; // نافذة اختيار صورة مفتوحة
      // مهلة صغيرة عشان وميض الفوكس العابر (مش تبديل حقيقي)
      blurTimer = setTimeout(() => {
        blurTimer = null;
        if (finishedRef.current) return;
        if (Date.now() < pickerUntil) return;
        if (!document.hasFocus() || document.visibilityState === "hidden") violation();
      }, 600);
    };
    const onFocus = () => { pickerUntil = 0; if (blurTimer) { clearTimeout(blurTimer); blurTimer = null; } };
    // بعض المتصفحات/الأنظمة (نافذتين جنب بعض، شاشة تانية، تقسيم الشاشة) مبتبعتش blur — فبنفحص الفوكس باستمرار
    const focusPoll = setInterval(() => { if (!document.hasFocus()) lostFocus(); }, 400);
    window.addEventListener("blur", lostFocus);
    window.addEventListener("focus", onFocus);

    const onPageHide = () => beacon("leave");
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (finishedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onVisibility = async () => {
      if (!data.block_on_tab_switch || finishedRef.current) return;
      if (document.visibilityState === "hidden") {
        violation();
      } else if (leftRef.current) {
        try { handleServerState(await save()); } catch { /* ignore */ }
      }
    };

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(focusPoll);
      if (blurTimer) clearTimeout(blurTimer);
      window.removeEventListener("blur", lostFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      // خروج من الصفحة داخل الموقع (من غير ريفريش). التأخير الصغير بيتجنب false-positive من StrictMode.
      mountedRef.current = false;
      setTimeout(() => { if (!mountedRef.current) beacon("leave"); }, 80);
    };
  }, [data.attemptId, data.token, data.block_on_tab_switch, handleServerState, save]);

  const imgQuery = `attemptId=${encodeURIComponent(data.attemptId)}&token=${encodeURIComponent(data.token)}`;

  const uploadImage = useCallback(async (qid: string, file: Blob) => {
    const q = data.questions.find((x) => x.id === qid);
    if (!q || q.image_mode === "none") return;
    setImgErr((p) => ({ ...p, [qid]: "" }));
    setImgBusy((p) => ({ ...p, [qid]: true }));
    try {
      const blob = await prepareImage(file);
      const r = await fetch(`/api/exam-image?${imgQuery}&qid=${encodeURIComponent(qid)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      });
      const j = await r.json();
      if (j.state === "uploaded") setImages((p) => ({ ...p, [qid]: j.images }));
      else if (j.state === "rejected") setImgErr((p) => ({ ...p, [qid]: j.error }));
      else handleServerState(j);
    } catch (e: any) {
      setImgErr((p) => ({ ...p, [qid]: e?.message || "فشل رفع الصورة، حاول تاني" }));
    } finally {
      setImgBusy((p) => ({ ...p, [qid]: false }));
    }
  }, [data.questions, imgQuery, handleServerState]);

  const removeImage = async (qid: string, name: string) => {
    setImgErr((p) => ({ ...p, [qid]: "" }));
    try {
      const r = await fetch(`/api/exam-image?${imgQuery}&qid=${encodeURIComponent(qid)}&name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const j = await r.json();
      if (j.state === "removed") setImages((p) => ({ ...p, [qid]: j.images }));
      else if (j.state !== "rejected") handleServerState(j);
    } catch {
      setImgErr((p) => ({ ...p, [qid]: "فشل حذف الصورة" }));
    }
  };

  // لصق الصور (Ctrl+V): الصور بس مسموحة، والنص يفضل ممنوع
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (!item) return;
      const file = item.getAsFile();
      if (!file) return;
      e.preventDefault();
      const imgQs = data.questions.filter((q) => q.image_mode !== "none");
      let qid = activeQidRef.current;
      if (!qid || !imgQs.some((q) => q.id === qid)) qid = imgQs.length === 1 ? imgQs[0].id : null;
      if (!qid) {
        setNotice(imgQs.length ? "اضغط جوه السؤال اللي عايز تلصق فيه الصورة الأول" : "مفيش أسئلة في الاختبار بتقبل صور");
        setTimeout(() => setNotice(""), 4000);
        return;
      }
      uploadImage(qid, file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [data.questions, uploadImage]);

  const askConfirm = () => {
    const missing = data.questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.image_mode === "required" && !(images[q.id]?.length));
    if (missing.length) {
      setSubmitError(`لازم ترفق صورة في السؤال: ${missing.map((m) => m.i + 1).join("، ")}`);
      return;
    }
    setSubmitError("");
    setConfirming(true);
  };

  const setAnswer = (qid: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: value };
      answersRef.current = next;
      return next;
    });
    dirtyRef.current = true;
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await save(true);
      if (!handleServerState(r)) setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  };

  const answered = data.questions.filter((q) => (answers[q.id] ?? "").trim() || (images[q.id]?.length ?? 0) > 0).length;

  const blockClip = {
    "data-no-clipboard": true,
    onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
    onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
    onCut: (e: React.ClipboardEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => e.preventDefault(),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    autoComplete: "off",
  } as const;

  // portal على document.body عشان شاشة الاختبار تغطي السايدبار (main عنده stacking context خاص)
  return createPortal(
    <div className="exam-root fixed inset-0 z-[70] overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="font-bold gold-text text-lg ml-auto">{data.title}</div>
          {personalLeft !== null && (
            <TimerBadge label="وقتك" ms={personalLeft} danger={personalLeft < 60_000} />
          )}
          {generalLeft !== null && (
            <TimerBadge label="وقت الاختبار" ms={generalLeft} danger={generalLeft < 60_000} general />
          )}
          <div className="text-xs text-muted-foreground">{answered}/{data.questions.length} تمت الإجابة</div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5 select-none">
        {data.questions.map((q, i) => (
          <QuestionCard
            key={q.id} index={i + 1} q={q} value={answers[q.id] ?? ""} onChange={(v) => setAnswer(q.id, v)} clip={blockClip}
            images={images[q.id] ?? []} busy={!!imgBusy[q.id]} error={imgErr[q.id] ?? ""}
            onActive={() => { activeQidRef.current = q.id; }}
            onAttach={(f) => uploadImage(q.id, f)} onRemove={(n) => removeImage(q.id, n)}
          />
        ))}

        <div className="pt-4 pb-16">
          {submitError && <div className="text-sm text-destructive mb-3">{submitError}</div>}
          {!confirming ? (
            <button onClick={askConfirm} disabled={submitting} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-60">
              <Send className="h-4 w-4" />تسليم الاختبار
            </button>
          ) : (
            <div className="rounded-xl border border-[var(--gold)]/50 bg-[var(--gold)]/10 p-4">
              <p className="mb-3 text-sm">
                متأكد إنك عايز تسلّم؟ مش هتقدر تعدّل بعد كده
                {answered < data.questions.length && ` (لسه ${data.questions.length - answered} سؤال من غير إجابة)`}.
              </p>
              <div className="flex gap-2">
                <button onClick={submit} disabled={submitting} className="btn-gold ripple inline-flex items-center gap-2 disabled:opacity-60">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}تأكيد التسليم
                </button>
                <button onClick={() => setConfirming(false)} disabled={submitting} className="px-4 py-2 rounded-md border border-border">رجوع</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="fixed bottom-6 inset-x-0 z-30 flex justify-center px-4 pointer-events-none">
          <div className="rounded-lg border border-[var(--gold)]/50 bg-background px-4 py-2 text-sm shadow-lg">{notice}</div>
        </div>
      )}

      {expired && (
        <div className="fixed inset-0 z-20 bg-background/90 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--gold)] mx-auto mb-3" />
            <div className="font-bold">انتهى الوقت — جارٍ تسليم إجاباتك...</div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function TimerBadge({ label, ms, danger, general }: { label: string; ms: number; danger: boolean; general?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2 text-sm px-3 py-1 rounded-lg border ${danger ? "border-destructive text-destructive animate-pulse" : "border-border text-foreground/90"}`}>
      {general ? <Lock className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span dir="ltr" className="font-mono font-bold">{fmt(ms)}</span>
    </div>
  );
}

function QuestionCard({
  index, q, value, onChange, clip, images, busy, error, onActive, onAttach, onRemove,
}: {
  index: number;
  q: ServedQuestion;
  value: string;
  onChange: (v: string) => void;
  clip: Record<string, unknown>;
  images: string[];
  busy: boolean;
  error: string;
  onActive: () => void;
  onAttach: (f: File) => void;
  onRemove: (name: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const canImage = q.image_mode !== "none";
  return (
    <div
      className="rounded-xl border border-border bg-card/80 p-5"
      onFocusCapture={canImage ? onActive : undefined}
      onMouseEnter={canImage ? onActive : undefined}
      onClick={canImage ? onActive : undefined}
    >
      <div className="flex gap-3 mb-4">
        <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-sm font-bold flex items-center justify-center">{index}</div>
        {q.type === "fix" ? <div className="font-semibold leading-loose text-[var(--gold)]">صحّح المعلومة الغلط في الجملة دي:</div> : <div className="font-semibold leading-loose whitespace-pre-wrap">{q.text}</div>}
      </div>

      {q.type === "choice" && (
        <div className="space-y-2">
          {q.options.map((o) => {
            const active = value === o;
            return (
              <button
                type="button"
                key={o}
                onClick={() => onChange(active ? "" : o)}
                className={`w-full text-right px-4 py-3 rounded-lg border transition flex items-center gap-3
                  ${active ? "border-[var(--gold)] bg-[var(--gold)]/15" : "border-border hover:bg-white/5"}`}
              >
                <span className={`h-4 w-4 rounded-full border-2 shrink-0 ${active ? "border-[var(--gold)] bg-[var(--gold)]" : "border-muted-foreground"}`} />
                <span className="whitespace-pre-wrap">{o}</span>
              </button>
            );
          })}
        </div>
      )}

      {(q.type === "tf" || q.type === "tf_fix") && (() => {
        const { verdict, fix } = parseTfFix(value);
        const set = (v: string) => onChange(q.type === "tf" ? (verdict === v ? "" : v) : buildTfFix(verdict === v ? "" : v, v === TF_FALSE ? fix : ""));
        return (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {[TF_TRUE, TF_FALSE].map((v) => {
                const active = verdict === v;
                return (
                  <button
                    type="button" key={v} onClick={() => set(v)}
                    className={`px-4 py-3 rounded-lg border transition flex items-center justify-center gap-3 font-bold
                      ${active ? "border-[var(--gold)] bg-[var(--gold)]/15" : "border-border hover:bg-white/5"}`}
                  >
                    <span className={`h-4 w-4 rounded-full border-2 shrink-0 ${active ? "border-[var(--gold)] bg-[var(--gold)]" : "border-muted-foreground"}`} />
                    {v}
                  </button>
                );
              })}
            </div>
            {q.type === "tf_fix" && verdict === TF_FALSE && (
              <div className="mt-4">
                <label className="text-sm text-muted-foreground mb-1 block">صوّب العبارة (اكتب الصح)</label>
                <textarea className="input select-text min-h-24" value={fix} maxLength={2000} onChange={(e) => onChange(buildTfFix(TF_FALSE, e.target.value))} placeholder="اكتب التصويب" {...clip} />
              </div>
            )}
          </div>
        );
      })()}

      {q.type === "fix" && <FixAnswer text={q.text} value={value} onChange={onChange} clip={clip} />}

      {q.type === "short" && (
        <input className="input select-text" value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} placeholder="اكتب إجابتك" {...clip} />
      )}

      {q.type === "long" && (
        <textarea className="input select-text min-h-40" value={value} maxLength={20000} onChange={(e) => onChange(e.target.value)} placeholder="اكتب إجابتك" {...clip} />
      )}

      {canImage && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { pickerUntil = Date.now() + 20_000; fileRef.current?.click(); }}
              disabled={busy || images.length >= q.max_images}
              className="px-3 py-1.5 rounded-md border border-border hover:border-[var(--gold)] text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              إرفاق صورة
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { pickerUntil = 0; const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }}
            />
            <span className="text-xs text-muted-foreground">
              أو الصق صورة (Ctrl+V) بعد ما تضغط جوه السؤال • {images.length}/{q.max_images}
              {q.image_mode === "required" && <span className="text-[var(--gold)]"> • صورة مطلوبة</span>}
            </span>
          </div>
          {error && <div className="text-sm text-destructive mt-2">{error}</div>}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-3">
              {images.map((n) => (
                <div key={n} className="relative">
                  <img src={`/api/exam-image/${n}`} alt="" draggable={false} className="h-28 max-w-56 rounded-lg border border-border object-contain bg-black/20" />
                  <button
                    type="button"
                    onClick={() => onRemove(n)}
                    title="حذف الصورة"
                    className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-destructive text-white flex items-center justify-center"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "صحح المعلومة": الطالب يحدد كلمة أو كلمتين بالماوس/اللمس، يدوس X في الكيبورد (أو زرار التصويب)،
 * وبعدها يكتب الصح مكانهم.
 */
function FixAnswer({ text, value, onChange, clip }: { text: string; value: string; onChange: (v: string) => void; clip: Record<string, unknown> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const cur = parseFix(value);
  const [hint, setHint] = useState("");
  const MAX_WORDS = 3;

  const grab = () => {
    const sel = window.getSelection();
    const box = boxRef.current;
    if (!sel || sel.rangeCount === 0 || !box) return setHint("حدد الكلمة الغلط الأول بالماوس أو بإصبعك");
    const range = sel.getRangeAt(0);
    if (!box.contains(range.commonAncestorContainer)) return setHint("حدد الكلمة من جوه الجملة");
    const picked = sel.toString().replace(/\s+/g, " ").trim();
    if (!picked) return setHint("حدد الكلمة الغلط الأول بالماوس أو بإصبعك");
    if (picked.split(" ").length > MAX_WORDS) return setHint(`حدد كلمة أو كلمتين بس (حد أقصى ${MAX_WORDS})`);
    setHint("");
    sel.removeAllRanges();
    onChange(buildFix(picked, cur?.from === picked ? cur.to : ""));
    setTimeout(() => toRef.current?.focus(), 0);
  };

  // الجملة مع تظليل الجزء المختار (أول ظهور له)
  const parts = (() => {
    if (!cur?.from) return null;
    const i = text.indexOf(cur.from);
    return i < 0 ? null : [text.slice(0, i), text.slice(i, i + cur.from.length), text.slice(i + cur.from.length)];
  })();

  return (
    <div>
      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={(e) => { if (e.code === "KeyX" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); grab(); } }}
        className="select-text rounded-lg border border-border bg-black/10 p-4 leading-loose text-lg whitespace-pre-wrap outline-none focus:border-[var(--gold)]/60"
        {...clip}
      >
        {parts ? (<>{parts[0]}<mark className="rounded bg-destructive/25 text-destructive line-through px-0.5">{parts[1]}</mark>{parts[2]}</>) : text}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>حدد الكلمة (أو الكلمتين) الغلط ثم دوس <kbd className="px-1.5 py-0.5 rounded border border-border font-mono">X</kbd> في الكيبورد</span>
        <button type="button" onClick={grab} className="px-3 py-1 rounded-md border border-border hover:border-[var(--gold)] text-foreground">تصويب المحدد</button>
        {cur?.from && <button type="button" onClick={() => onChange("")} className="px-3 py-1 rounded-md border border-border hover:border-destructive">إلغاء التحديد</button>}
      </div>
      {hint && <div className="mt-2 text-sm text-destructive">{hint}</div>}
      {cur?.from && (
        <div className="mt-4">
          <label className="text-sm text-muted-foreground mb-1 block">اكتب الصح مكان «<span className="text-destructive">{cur.from}</span>»</label>
          <input
            ref={toRef} className="input select-text" value={cur.to} maxLength={200}
            onChange={(e) => onChange(buildFix(cur.from, e.target.value))} placeholder="الإجابة الصح" {...clip}
          />
        </div>
      )}
    </div>
  );
}
