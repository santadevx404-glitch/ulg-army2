// نظام الاختبارات — منطق السيرفر. التخزين دلوقتي لوكال (data/exams.json و data/exam-attempts.json)
// عن طريق طبقة kv-store، وبعدين لما نربط Supabase نفس الدوال بتشتغل من غير تغيير في المنطق.
//
// ملحوظات تصميم:
//  - مفيش تصحيح تلقائي ولا درجات: الإجابات بتتحفظ بس، وانت بتراجعها من لوحة التحكم.
//  - الوقت كله بيتحسب على السيرفر (التايمر الشخصي + التايمر العام)، والتسليم الأوتوماتيك
//    بيحصل عند أي طلب بعد انتهاء الوقت، فمش معتمد على المتصفح.
//  - الشخص بيتعرّف بأول حقل في "بيانات الدخول" (مثلاً اسم الحساب).
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";
import { signValue, verifySigned } from "./local-auth.server";
import { bypasses, normBypass, type Bypass, type Viewer } from "./bypass";
import { MAX_IMAGE_BYTES, deleteExamImages, detectImageExt, saveExamImage } from "./exam-images.server";

const EXAMS_KEY = "bwd:exams";
const ATTEMPTS_KEY = "bwd:exam-attempts";

// سماحية بسيطة (ثواني) لآخر حفظ بيوصل مع انتهاء الوقت بسبب بطء الشبكة
const SUBMIT_GRACE_MS = 15_000;

// ============================== Types ==============================

export type QType = "choice" | "short" | "long";
export type QKind = "core" | "optional";
export type GradingMode = "manual" | "auto";
export type ExamAccess = "open" | "locked" | "hidden";
export type ImageMode = "none" | "optional" | "required"; // none = من غير صور | optional = صور اختيارية | required = صورة إجبارية

export type Question = {
  id: string;
  exam_id: string;
  kind: QKind; // core = أساسي بيظهر للكل | optional = بيتسحب عشوائي
  type: QType; // choice = اختيارات | short = إجابة قصيرة | long = إجابة طويلة
  text: string;
  options: string[]; // للـ choice بس
  image_mode: ImageMode; // هل الشخص يقدر/لازم يرفق صور مع إجابته
  max_images: number; // أقصى عدد صور للسؤال
  model_answer: string | null; // بيظهر للأدمن بس وقت المراجعة
  points: number; // درجة السؤال
  correct_answer: string | null; // للـ choice: نص الاختيار الصح (للتصحيح التلقائي) — مبيظهرش للطلاب
  sort_order: number;
  created_at: string;
};

export type Exam = {
  id: string;
  title: string;
  description: string;
  published: boolean;
  access: ExamAccess; // open = مفتوح | locked = اسمه ظاهر وبكلمة سر | hidden = مشفّر (اسمه مخفي لحد كلمة السر)
  password: string | null;
  bypass: Bypass | null; // أشخاص/رتب تدخل من غير كلمة السر
  fields: string[]; // (قديم) بيانات الدخول — دلوقتي البيانات بتتاخد من الحساب
  grading: GradingMode; // manual = تصحيح يدوي | auto = الاختيارات تلقائي والنصي يدوي
  optional_count: number; // كام سؤال اختياري يتسحب لكل شخص
  shuffle: boolean; // ترتيب الأسئلة والاختيارات عشوائي
  attempt_minutes: number | null; // التايمر الشخصي (من لحظة فتح الاختبار)
  ends_at: string | null; // التايمر العام (ISO)
  block_on_tab_switch: boolean; // يحظر لو الشخص بدّل التاب
  intro_message: string; // نص يظهر قبل البدء (اختياري)
  submit_message: string; // رسالة بعد التسليم
  timeout_message: string; // رسالة انتهاء الوقت (لو فاضية بتظهر رسالة التسليم)
  block_message: string; // رسالة الحظر
  closed_message: string; // رسالة لو الاختبار انتهى قبل ما الشخص يبدأ
  created_at: string;
  updated_at: string;
};

export type ServedQuestion = {
  id: string;
  type: QType;
  text: string;
  options: string[];
  image_mode: ImageMode;
  max_images: number;
  points: number;
};

export type AttemptStatus = "in_progress" | "submitted" | "blocked" | "unblocked" | "retired";
export type SubmitReason = "manual" | "attempt_timer" | "exam_timer";
export type BlockReason = "leave" | "tab_switch" | "reentry";

export type Attempt = {
  id: string;
  exam_id: string;
  identity: string;
  user_id: string | null; // صاحب الحساب (الاختبارات للمسجلين بس)
  fields: Record<string, string>;
  scores: Record<string, number>; // درجات التصحيح اليدوي لكل سؤال
  graded_at: string | null; // وقت ما الأدمن حفظ التصحيح
  graded_by: string | null;
  token: string;
  attempt_no: number;
  status: AttemptStatus;
  questions: ServedQuestion[]; // snapshot للأسئلة اللي نزلت للشخص دا بالترتيب
  answers: Record<string, string>;
  images: Record<string, string[]>; // أسماء ملفات الصور لكل سؤال
  started_at: string;
  attempt_deadline_at: string | null;
  last_saved_at: string | null;
  last_seen_at: string;
  submitted_at: string | null;
  submit_reason: SubmitReason | null;
  block_code: string | null;
  block_reason: BlockReason | null;
  blocked_at: string | null;
  unblocked_at: string | null;
};

type ExamsDB = { exams: Exam[]; questions: Question[] };
type AttemptsDB = { attempts: Attempt[] };

// ============================== Storage ==============================

const withLock = makeLock();

function normalizeExam(e: Partial<Exam>): Exam {
  const now = new Date().toISOString();
  return {
    id: e.id ?? crypto.randomUUID(),
    title: e.title ?? "",
    description: e.description ?? "",
    published: e.published ?? false,
    access: e.access === "locked" || e.access === "hidden" ? e.access : "open",
    password: e.access === "locked" || e.access === "hidden" ? (e.password ?? null) : null,
    bypass: e.access === "locked" || e.access === "hidden" ? normBypass(e.bypass) : null,
    fields: Array.isArray(e.fields) && e.fields.length ? e.fields : ["اسم الحساب", "الاسم"],
    grading: e.grading === "auto" ? "auto" : "manual",
    optional_count: e.optional_count ?? 0,
    shuffle: e.shuffle ?? true,
    attempt_minutes: e.attempt_minutes ?? null,
    ends_at: e.ends_at ?? null,
    block_on_tab_switch: e.block_on_tab_switch ?? false,
    intro_message: e.intro_message ?? "",
    submit_message: e.submit_message ?? "تم استلام إجاباتك.",
    timeout_message: e.timeout_message ?? "",
    block_message: e.block_message ?? "تم إيقافك عن الاختبار. تواصل مع الإدارة وابعتلهم كود الحظر.",
    closed_message: e.closed_message ?? "انتهى وقت هذا الاختبار.",
    created_at: e.created_at ?? now,
    updated_at: e.updated_at ?? now,
  };
}

async function readExamsDb(): Promise<ExamsDB> {
  const raw = await kvGetJSON<Partial<ExamsDB>>(EXAMS_KEY, { exams: [], questions: [] });
  return {
    exams: (raw.exams ?? []).map(normalizeExam),
    questions: (raw.questions ?? []).map((q) => ({
      ...q,
      options: q.options ?? [],
      image_mode: q.image_mode ?? "none",
      max_images: q.max_images ?? 3,
      model_answer: q.model_answer ?? null,
      points: typeof q.points === "number" && q.points >= 0 ? q.points : 1,
      correct_answer: q.correct_answer ?? null,
    })),
  };
}
async function writeExamsDb(db: ExamsDB) {
  await kvSetJSON(EXAMS_KEY, db);
}
async function readAttemptsDb(): Promise<AttemptsDB> {
  const raw = await kvGetJSON<Partial<AttemptsDB>>(ATTEMPTS_KEY, { attempts: [] });
  return {
    attempts: (raw.attempts ?? []).map((a) => ({
      ...a,
      images: a.images ?? {},
      user_id: a.user_id ?? null,
      scores: a.scores ?? {},
      graded_at: a.graded_at ?? null,
      graded_by: a.graded_by ?? null,
      questions: (a.questions ?? []).map((q) => ({ ...q, image_mode: q.image_mode ?? "none", max_images: q.max_images ?? 3, points: typeof q.points === "number" ? q.points : 1 })),
    })),
  };
}
async function writeAttemptsDb(db: AttemptsDB) {
  await kvSetJSON(ATTEMPTS_KEY, db);
}

// ============================== Helpers ==============================

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function normalizeIdentity(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeBlockCode(taken: Set<string>): string {
  for (let tries = 0; tries < 50; tries++) {
    let s = "";
    for (let i = 0; i < 4; i++) s += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    const code = `BLK-${s}`;
    if (!taken.has(code)) return code;
  }
  return `BLK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function timeMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** أقرب موعد انتهاء (شخصي أو عام) + السبب لو انتهى */
function deadlineInfo(att: Attempt, exam: Exam): { at: number | null; reason: SubmitReason | null } {
  const personal = timeMs(att.attempt_deadline_at);
  const general = timeMs(exam.ends_at);
  if (personal === null && general === null) return { at: null, reason: null };
  if (general !== null && (personal === null || general <= personal)) return { at: general, reason: "exam_timer" };
  return { at: personal, reason: "attempt_timer" };
}

function timeoutText(exam: Exam): string {
  return exam.timeout_message.trim() || exam.submit_message;
}

function messageFor(exam: Exam, reason: SubmitReason | null): string {
  return reason === "manual" || reason === null ? exam.submit_message : timeoutText(exam);
}

function sanitizeAnswers(att: Attempt, incoming: Record<string, unknown> | undefined): Record<string, string> {
  const allowed = new Set(att.questions.map((q) => q.id));
  const out: Record<string, string> = { ...att.answers };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (!allowed.has(k)) continue;
    out[k] = String(v ?? "").slice(0, 20_000);
  }
  return out;
}

function finalize(att: Attempt, reason: SubmitReason, atMs: number) {
  att.status = "submitted";
  att.submit_reason = reason;
  att.submitted_at = new Date(atMs).toISOString();
}

/** لو المحاولة الجارية عدّى وقتها يتم تسليمها أوتوماتيك. بيرجع true لو اتغيّرت. */
function expireIfNeeded(att: Attempt, exam: Exam | undefined, now: number): boolean {
  if (att.status !== "in_progress" || !exam) return false;
  const { at, reason } = deadlineInfo(att, exam);
  if (at !== null && reason && now >= at) {
    finalize(att, reason, at);
    return true;
  }
  return false;
}

// ============================== Public API ==============================

export type PublicExam = {
  id: string;
  title: string;
  description: string;
  ends_at: string | null;
  attempt_minutes: number | null;
  closed: boolean;
  locked: boolean; // محتاج كلمة سر (الاسم ظاهر)
};

/** القايمة العامة: المنشور بس، والمشفّر (hidden) مبيظهرش خالص. */
export async function listPublicExams(viewer: Viewer = null): Promise<PublicExam[]> {
  const db = await readExamsDb();
  const now = Date.now();
  return db.exams
    // المشفّر مبيظهرش غير للمستثنين من كلمة سره
    .filter((e) => e.published && (e.access !== "hidden" || bypasses(viewer, e.bypass)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => {
      const end = timeMs(e.ends_at);
      return {
        id: e.id,
        title: e.title,
        description: e.description,
        ends_at: e.ends_at,
        attempt_minutes: e.attempt_minutes,
        closed: end !== null && now >= end,
        locked: e.access === "locked" && !bypasses(viewer, e.bypass),
      };
    });
}

export type PublicExamInfo = PublicExam & { fields: string[]; intro_message: string };

export type PublicExamResult =
  | { state: "ok"; info: PublicExamInfo; token?: string } // token: للمستثنين من كلمة السر (بيتولّد من غير كلمة)
  | { state: "gate"; id: string; title: string | null } // لازم كلمة سر (العنوان بيظهر بس للمقفول مش المشفّر)
  | { state: "unavailable" };

const ACCESS_TTL = 60 * 60 * 12; // 12 ساعة
const ACCESS_PURPOSE = "exam-access";

async function tokenOk(examId: string, token?: string | null): Promise<boolean> {
  return (await verifySigned(ACCESS_PURPOSE, token)) === examId;
}

function toPublic(e: Exam): PublicExamInfo {
  const end = timeMs(e.ends_at);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    ends_at: e.ends_at,
    attempt_minutes: e.attempt_minutes,
    closed: end !== null && Date.now() >= end,
    locked: e.access === "locked",
    fields: e.fields,
    intro_message: e.intro_message,
  };
}

/**
 * بيرجع تفاصيل الاختبار للزائر.
 * المشفّر والمجهول والمسودة المقفولة كلهم بيرجعوا نفس الـ "gate" من غير عنوان،
 * فمحدش يقدر يعرف إن اختبار مشفّر موجود من غير كلمة السر.
 */
export async function getPublicExam(id: string, token?: string | null, viewer: Viewer = null): Promise<PublicExamResult> {
  const db = await readExamsDb();
  const exam = db.exams.find((e) => e.id === id);
  if (!exam) return { state: "gate", id, title: null };
  if (exam.access === "open") return exam.published ? { state: "ok", info: toPublic(exam) } : { state: "unavailable" };
  if (!exam.published) return { state: "gate", id, title: null };
  if (await tokenOk(exam.id, token)) return { state: "ok", info: toPublic(exam) };
  // مستثنى من كلمة السر: بندّيه توكن الدخول مباشرة
  if (bypasses(viewer, exam.bypass)) return { state: "ok", info: toPublic(exam), token: await signValue(ACCESS_PURPOSE, exam.id, ACCESS_TTL) };
  return { state: "gate", id, title: exam.access === "locked" ? exam.title : null };
}

// ---- فتح الاختبارات بكلمة سر (مع حماية من التخمين) ----
const attemptsByKey = new Map<string, number[]>();
let globalAttempts: number[] = [];

function throttled(key: string): boolean {
  const now = Date.now();
  const fresh = (attemptsByKey.get(key) ?? []).filter((t) => now - t < 60_000);
  globalAttempts = globalAttempts.filter((t) => now - t < 60_000);
  attemptsByKey.set(key, fresh);
  return fresh.length >= 8 || globalAttempts.length >= 80;
}
function noteFailure(key: string) {
  const now = Date.now();
  attemptsByKey.set(key, [...(attemptsByKey.get(key) ?? []), now]);
  globalAttempts.push(now);
}
function samePassword(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type UnlockResult =
  | { state: "ok"; examId: string; token: string; title: string }
  | { state: "wrong" }
  | { state: "limited" };

/** كلمة السر بتفتح الاختبار المحدد (المقفول). */
export async function unlockExam(examId: string, password: string, who: string): Promise<UnlockResult> {
  if (throttled(who)) return { state: "limited" };
  const db = await readExamsDb();
  const exam = db.exams.find((e) => e.id === examId);
  const pw = String(password ?? "");
  if (!exam || !exam.published || exam.access === "open" || !exam.password || !pw || !samePassword(pw, exam.password)) {
    noteFailure(who);
    return { state: "wrong" };
  }
  return { state: "ok", examId: exam.id, title: exam.title, token: await signValue(ACCESS_PURPOSE, exam.id, ACCESS_TTL) };
}

/** كلمة السر لوحدها بتدوّر على الاختبار (للمشفّر اللي مفيش له اسم ظاهر). */
export async function unlockByPassword(password: string, who: string): Promise<UnlockResult> {
  if (throttled(who)) return { state: "limited" };
  const db = await readExamsDb();
  const pw = String(password ?? "");
  const exam = pw ? db.exams.find((e) => e.published && e.access !== "open" && e.password && samePassword(pw, e.password)) : undefined;
  if (!exam) {
    noteFailure(who);
    return { state: "wrong" };
  }
  return { state: "ok", examId: exam.id, title: exam.title, token: await signValue(ACCESS_PURPOSE, exam.id, ACCESS_TTL) };
}

/** للطبقة اللي فوق (الصلاحيات): الاختبار الخام. */
export async function adminGetExam(id: string): Promise<Exam | null> {
  const db = await readExamsDb();
  return db.exams.find((e) => e.id === id) ?? null;
}

export type StartResult =
  | { state: "error"; error: string }
  | { state: "closed"; message: string }
  | { state: "submitted"; message: string }
  | { state: "blocked"; code: string; message: string }
  | {
      state: "started";
      attemptId: string;
      token: string;
      questions: ServedQuestion[];
      answers: Record<string, string>;
      attempt_deadline_at: string | null;
      exam_ends_at: string | null;
      server_now: string;
      block_on_tab_switch: boolean;
      title: string;
    };

/** المستخدم المسجّل اللي بيدخل الاختبار — بياناته بتتاخد من حسابه تلقائي. */
export type ExamUser = { id: string; account_name: string; character_name: string };

const identityOf = (u: ExamUser) => `u:${u.id}`;
function fieldsOf(u: ExamUser): Record<string, string> {
  return { "اسم الحساب": u.account_name, "الاسم": u.character_name };
}

/** بيحسم حالة الشخص لو عنده محاولات سابقة، من غير ما يعمل محاولة جديدة. */
function resolveExisting(
  mine: Attempt[],
  exam: Exam,
  allAttempts: Attempt[],
  now: number,
  blockReentry: boolean,
): { result: StartResult | null; dirty: boolean } {
  let dirty = false;
  for (const a of mine) if (expireIfNeeded(a, exam, now)) dirty = true;

  const blocked = mine.find((a) => a.status === "blocked");
  if (blocked) {
    return { result: { state: "blocked", code: blocked.block_code ?? "", message: exam.block_message }, dirty };
  }

  const running = mine.find((a) => a.status === "in_progress");
  if (running) {
    if (!blockReentry) return { result: null, dirty };
    // دخول تاني على محاولة جارية = ريفريش/خروج → حظر
    running.status = "blocked";
    running.block_reason = "reentry";
    running.blocked_at = new Date(now).toISOString();
    running.block_code = makeBlockCode(new Set(allAttempts.map((a) => a.block_code ?? "")));
    return { result: { state: "blocked", code: running.block_code, message: exam.block_message }, dirty: true };
  }

  const done = mine.find((a) => a.status === "submitted");
  if (done) {
    return { result: { state: "submitted", message: messageFor(exam, done.submit_reason) }, dirty };
  }
  return { result: null, dirty };
}

export async function startExam(examId: string, user: ExamUser, accessToken?: string | null): Promise<StartResult> {
  return withLock(async () => {
    const exams = await readExamsDb();
    const exam = exams.exams.find((e) => e.id === examId);
    if (!exam || !exam.published) return { state: "error", error: "الاختبار غير متاح" } as StartResult;
    if (exam.access !== "open" && !(await tokenOk(exam.id, accessToken))) {
      return { state: "error", error: "الاختبار ده محتاج كلمة سر" } as StartResult;
    }

    const fields = fieldsOf(user);
    const identity = identityOf(user);
    const attemptsDb = await readAttemptsDb();
    const now = Date.now();
    const mine = attemptsDb.attempts.filter((a) => a.exam_id === examId && a.identity === identity);

    const { result, dirty } = resolveExisting(mine, exam, attemptsDb.attempts, now, true);
    if (dirty) await writeAttemptsDb(attemptsDb);
    if (result) return result;

    const end = timeMs(exam.ends_at);
    if (end !== null && now >= end) return { state: "closed", message: exam.closed_message };

    // ---- سحب الأسئلة ----
    const all = exams.questions.filter((q) => q.exam_id === examId);
    const core = all.filter((q) => q.kind === "core").sort((a, b) => a.sort_order - b.sort_order);
    const pool = all.filter((q) => q.kind === "optional");
    if (core.length + pool.length === 0) return { state: "error", error: "الاختبار لسه مفيهوش أسئلة" } as StartResult;

    const seenByMe = new Set(mine.flatMap((a) => a.questions.map((q) => q.id)));
    const usage = new Map<string, number>();
    for (const a of attemptsDb.attempts) {
      if (a.exam_id !== examId) continue;
      for (const q of a.questions) usage.set(q.id, (usage.get(q.id) ?? 0) + 1);
    }
    // الأسئلة اللي الشخص ماشافهاش الأول، وبعدين الأقل ظهورًا للناس (توزيع متوازن)، والباقي عشوائي
    const order = (arr: Question[]) => shuffle(arr).sort((a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0));
    const fresh = order(pool.filter((q) => !seenByMe.has(q.id)));
    const stale = order(pool.filter((q) => seenByMe.has(q.id)));
    const picked = [...fresh, ...stale].slice(0, Math.max(0, exam.optional_count));

    let chosen = [...core, ...picked];
    if (exam.shuffle) chosen = shuffle(chosen);

    const served: ServedQuestion[] = chosen.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.type === "choice" ? (exam.shuffle ? shuffle(q.options) : q.options) : [],
      image_mode: q.image_mode,
      max_images: q.max_images,
      points: q.points,
    }));

    const startedAt = new Date(now);
    const att: Attempt = {
      id: crypto.randomUUID(),
      exam_id: examId,
      identity,
      user_id: user.id,
      fields,
      scores: {},
      graded_at: null,
      graded_by: null,
      token: crypto.randomBytes(24).toString("hex"),
      attempt_no: mine.length + 1,
      status: "in_progress",
      questions: served,
      answers: {},
      images: {},
      started_at: startedAt.toISOString(),
      attempt_deadline_at: exam.attempt_minutes
        ? new Date(now + exam.attempt_minutes * 60_000).toISOString()
        : null,
      last_saved_at: null,
      last_seen_at: startedAt.toISOString(),
      submitted_at: null,
      submit_reason: null,
      block_code: null,
      block_reason: null,
      blocked_at: null,
      unblocked_at: null,
    };
    attemptsDb.attempts.push(att);
    await writeAttemptsDb(attemptsDb);

    return {
      state: "started",
      attemptId: att.id,
      token: att.token,
      questions: served,
      answers: {},
      attempt_deadline_at: att.attempt_deadline_at,
      exam_ends_at: exam.ends_at,
      server_now: startedAt.toISOString(),
      block_on_tab_switch: exam.block_on_tab_switch,
      title: exam.title,
    } satisfies StartResult;
  });
}

export type PollResult =
  | { state: "error"; error: string }
  | { state: "can_start" }
  | { state: "closed"; message: string }
  | { state: "submitted"; message: string }
  | { state: "blocked"; code: string; message: string };

/** للشاشة بتاعة الحظر: تتأكد لو الأدمن فك الحظر (من غير ما تبدأ محاولة). */
export async function pollExamState(examId: string, user: ExamUser, accessToken?: string | null): Promise<PollResult> {
  return withLock(async () => {
    const exams = await readExamsDb();
    const exam = exams.exams.find((e) => e.id === examId);
    if (!exam || !exam.published) return { state: "error", error: "الاختبار غير متاح" } as PollResult;
    if (exam.access !== "open" && !(await tokenOk(exam.id, accessToken))) {
      return { state: "error", error: "الاختبار ده محتاج كلمة سر" } as PollResult;
    }
    const identity = identityOf(user);
    const attemptsDb = await readAttemptsDb();
    const now = Date.now();
    const mine = attemptsDb.attempts.filter((a) => a.exam_id === examId && a.identity === identity);
    const { result, dirty } = resolveExisting(mine, exam, attemptsDb.attempts, now, false);
    if (dirty) await writeAttemptsDb(attemptsDb);
    if (result && (result.state === "blocked" || result.state === "submitted")) return result;
    const end = timeMs(exam.ends_at);
    if (end !== null && now >= end) return { state: "closed", message: exam.closed_message };
    return { state: "can_start" };
  });
}

export type SaveResult =
  | { state: "invalid" }
  | { state: "ok"; server_now: string }
  | { state: "submitted"; message: string; reason: SubmitReason | null }
  | { state: "blocked"; code: string; message: string };

async function loadAttemptForClient(attemptId: string, token: string) {
  const attemptsDb = await readAttemptsDb();
  const att = attemptsDb.attempts.find((a) => a.id === attemptId);
  if (!att || att.token !== token) return null;
  const exams = await readExamsDb();
  const exam = exams.exams.find((e) => e.id === att.exam_id);
  if (!exam) return null;
  return { attemptsDb, att, exam };
}

function terminalResult(att: Attempt, exam: Exam): SaveResult | null {
  if (att.status === "blocked") return { state: "blocked", code: att.block_code ?? "", message: exam.block_message };
  if (att.status === "submitted") {
    return { state: "submitted", message: messageFor(exam, att.submit_reason), reason: att.submit_reason };
  }
  if (att.status !== "in_progress") return { state: "invalid" };
  return null;
}

/** حفظ تلقائي/نبض: بيحدّث الإجابات، ولو الوقت خلص بيسلّم أوتوماتيك. */
export async function saveAnswers(
  attemptId: string,
  token: string,
  answers: Record<string, string>,
  final = false,
): Promise<SaveResult> {
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { state: "invalid" } as SaveResult;
    const { attemptsDb, att, exam } = loaded;
    const now = Date.now();

    const terminal = terminalResult(att, exam);
    if (terminal) return terminal;

    const { at, reason } = deadlineInfo(att, exam);
    const nowIso = new Date(now).toISOString();

    if (at !== null && reason && now >= at) {
      // الوقت خلص: نقبل آخر إجابات لو وصلت في فترة السماحية، ونسلّم
      if (now <= at + SUBMIT_GRACE_MS) att.answers = sanitizeAnswers(att, answers);
      finalize(att, reason, at);
      await writeAttemptsDb(attemptsDb);
      return { state: "submitted", message: timeoutText(exam), reason };
    }

    att.answers = sanitizeAnswers(att, answers);
    att.last_saved_at = nowIso;
    att.last_seen_at = nowIso;

    if (final) {
      finalize(att, "manual", now);
      await writeAttemptsDb(attemptsDb);
      return { state: "submitted", message: exam.submit_message, reason: "manual" };
    }
    await writeAttemptsDb(attemptsDb);
    return { state: "ok", server_now: nowIso };
  });
}

export type ImageResult =
  | { state: "uploaded"; name: string; images: string[] }
  | { state: "removed"; images: string[] }
  | { state: "rejected"; error: string }
  | Exclude<SaveResult, { state: "ok" }>;

/** رفع صورة لإجابة سؤال. نفس فحوصات الوقت/الحظر بتاعة الحفظ. */
export async function addAttemptImage(attemptId: string, token: string, qid: string, bytes: Buffer): Promise<ImageResult> {
  const ext = detectImageExt(bytes);
  if (!ext) return { state: "rejected", error: "الملف مش صورة مدعومة (JPG / PNG / WEBP / GIF)" };
  if (bytes.length > MAX_IMAGE_BYTES) return { state: "rejected", error: "الصورة أكبر من 4 ميجا" };
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { state: "invalid" } as ImageResult;
    const { attemptsDb, att, exam } = loaded;
    const terminal = terminalResult(att, exam);
    if (terminal) return terminal as ImageResult;

    const now = Date.now();
    if (expireIfNeeded(att, exam, now)) {
      await writeAttemptsDb(attemptsDb);
      return { state: "submitted", message: timeoutText(exam), reason: att.submit_reason } as ImageResult;
    }

    const q = att.questions.find((x) => x.id === qid);
    if (!q || q.image_mode === "none") return { state: "rejected", error: "السؤال ده مش بيقبل صور" };
    const list = att.images[qid] ?? [];
    if (list.length >= q.max_images) return { state: "rejected", error: `أقصى عدد صور للسؤال ده ${q.max_images}` };

    const name = await saveExamImage(bytes, ext);
    att.images = { ...att.images, [qid]: [...list, name] };
    att.last_seen_at = new Date(now).toISOString();
    await writeAttemptsDb(attemptsDb);
    return { state: "uploaded", name, images: att.images[qid] };
  });
}

export async function removeAttemptImage(attemptId: string, token: string, qid: string, name: string): Promise<ImageResult> {
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { state: "invalid" } as ImageResult;
    const { attemptsDb, att, exam } = loaded;
    const terminal = terminalResult(att, exam);
    if (terminal) return terminal as ImageResult;
    const list = att.images[qid] ?? [];
    if (!list.includes(name)) return { state: "removed", images: list };
    att.images = { ...att.images, [qid]: list.filter((n) => n !== name) };
    att.last_seen_at = new Date().toISOString();
    await writeAttemptsDb(attemptsDb);
    await deleteExamImages([name]);
    return { state: "removed", images: att.images[qid] };
  });
}

/** المتصفح بلّغ إن الشخص خرج/عمل ريفريش/بدّل التاب. */
export async function reportLeave(
  attemptId: string,
  token: string,
  reason: BlockReason,
  answers?: Record<string, string>,
): Promise<{ ok: boolean }> {
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { ok: false };
    const { attemptsDb, att, exam } = loaded;
    if (att.status !== "in_progress") return { ok: true };

    const now = Date.now();
    if (answers) att.answers = sanitizeAnswers(att, answers);

    if (expireIfNeeded(att, exam, now)) {
      await writeAttemptsDb(attemptsDb);
      return { ok: true };
    }
    if (reason === "tab_switch" && !exam.block_on_tab_switch) return { ok: true };

    att.status = "blocked";
    att.block_reason = reason;
    att.blocked_at = new Date(now).toISOString();
    att.block_code = makeBlockCode(new Set(attemptsDb.attempts.map((a) => a.block_code ?? "")));
    att.last_saved_at = att.blocked_at;
    await writeAttemptsDb(attemptsDb);
    return { ok: true };
  });
}

// ============================== التصحيح والدرجات ==============================

export type QGrade = { id: string; max: number; score: number | null; auto: boolean };
export type AttemptGrade = { items: QGrade[]; total: number; max: number; complete: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * درجة كل سؤال: الدرجة اليدوية لو الأدمن حطها، وإلا (في التصحيح التلقائي) سؤال الاختيارات
 * بيتقارن بالإجابة الصح اللي الأدمن محددها. غير كدا = لسه مستني تصحيح (null).
 */
export function gradeAttempt(att: Attempt, exam: Exam | undefined, live: Map<string, Question>): AttemptGrade {
  const items: QGrade[] = att.questions.map((sq) => {
    const max = sq.points;
    const manual = att.scores[sq.id];
    if (typeof manual === "number") return { id: sq.id, max, score: Math.min(max, Math.max(0, manual)), auto: false };
    const key = live.get(sq.id)?.correct_answer;
    if (exam?.grading === "auto" && sq.type === "choice" && key) {
      const ans = (att.answers[sq.id] ?? "").trim();
      return { id: sq.id, max, score: ans && ans === key.trim() ? max : 0, auto: true };
    }
    return { id: sq.id, max, score: null, auto: false };
  });
  const total = round2(items.reduce((s, i) => s + (i.score ?? 0), 0));
  const max = round2(items.reduce((s, i) => s + i.max, 0));
  return { items, total, max, complete: items.every((i) => i.score !== null) };
}

/** النتيجة بتظهر للطالب لو الأدمن حفظ التصحيح، أو (تلقائي) كل الأسئلة اتصححت. */
function isReleased(att: Attempt, g: AttemptGrade): boolean {
  if (att.status !== "submitted" && att.status !== "retired") return false;
  return !!att.graded_at || g.complete;
}

/** حفظ تصحيح محاولة: درجة لكل سؤال (0 → الحد الأقصى للسؤال). الأسئلة اللي مفيهاش درجة بتتحسب 0. */
export async function adminGradeAttempt(id: string, scores: Record<string, unknown>, gradedBy: string): Promise<{ total: number; max: number }> {
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const att = attemptsDb.attempts.find((a) => a.id === id);
    if (!att) throw new Error("المحاولة غير موجودة");
    if (att.status !== "submitted" && att.status !== "retired") throw new Error("المحاولة لسه ماتسلّمتش");
    const exams = await readExamsDb();
    const exam = exams.exams.find((e) => e.id === att.exam_id);
    const live = new Map(exams.questions.map((q) => [q.id, q]));
    const next: Record<string, number> = { ...att.scores };
    for (const sq of att.questions) {
      const raw = scores[sq.id];
      if (raw === undefined || raw === null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error("درجة غير صحيحة");
      if (n < 0 || n > sq.points) throw new Error(`الدرجة لازم تكون بين 0 و ${sq.points}`);
      next[sq.id] = round2(n);
    }
    att.scores = next;
    // أي سؤال لسه من غير درجة (نصي لم يتصحح) بيتحسب صفر عند الحفظ
    const after = gradeAttempt(att, exam, live);
    for (const it of after.items) if (it.score === null) att.scores[it.id] = 0;
    att.graded_at = new Date().toISOString();
    att.graded_by = gradedBy;
    await writeAttemptsDb(attemptsDb);
    const final = gradeAttempt(att, exam, live);
    return { total: final.total, max: final.max };
  });
}

export type MyResultItem = {
  id: string;
  type: QType;
  text: string;
  options: string[];
  answer: string;
  max: number;
  score: number;
  verdict: "correct" | "partial" | "wrong";
};
export type MyResult = {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  attempt_no: number;
  submitted_at: string | null;
  graded: boolean;
  total: number | null;
  max: number;
  items: MyResultItem[]; // فاضية لو لسه ماتصححش
};

/** نتائج اختبارات المستخدم نفسه — الدرجات والصح/الغلط بتظهر بعد التصحيح بس. */
export async function myResults(userId: string): Promise<MyResult[]> {
  const exams = await readExamsDb();
  const attemptsDb = await readAttemptsDb();
  const live = new Map(exams.questions.map((q) => [q.id, q]));
  const out: MyResult[] = [];
  for (const a of attemptsDb.attempts) {
    if (a.user_id !== userId) continue;
    if (a.status !== "submitted" && a.status !== "retired") continue;
    const exam = exams.exams.find((e) => e.id === a.exam_id);
    const g = gradeAttempt(a, exam, live);
    const released = isReleased(a, g);
    out.push({
      attempt_id: a.id,
      exam_id: a.exam_id,
      exam_title: exam?.title ?? "(اختبار محذوف)",
      attempt_no: a.attempt_no,
      submitted_at: a.submitted_at,
      graded: released,
      total: released ? g.total : null,
      max: g.max,
      items: released
        ? a.questions.map((sq, i) => {
            const score = g.items[i].score ?? 0;
            return {
              id: sq.id,
              type: sq.type,
              text: sq.text,
              options: sq.options,
              answer: a.answers[sq.id] ?? "",
              max: sq.points,
              score,
              verdict: score >= sq.points ? "correct" : score > 0 ? "partial" : "wrong",
            } satisfies MyResultItem;
          })
        : [],
    });
  }
  return out.sort((x, y) => (y.submitted_at ?? "").localeCompare(x.submitted_at ?? ""));
}

// ============================== Admin API ==============================

export type ExamCan = {
  settings: Record<string, boolean>; // لكل مجموعة إعدادات: يقدر يعدّلها؟
  anySettings: boolean;
  questions: { view: boolean; add: boolean; edit: boolean; delete: boolean };
  review: { view: boolean; delete: boolean; grade: boolean };
  unblock: boolean;
  delete: boolean;
};

export type AdminExam = Exam & {
  can?: ExamCan; // بيتحط في طبقة الـ server functions حسب صلاحيات المستخدم
  core_count: number;
  optional_count_pool: number;
  attempts: { in_progress: number; submitted: number; blocked: number };
};

/** مساعدات للصلاحيات: ربط المحاولات/الأسئلة باختباراتها */
export async function examIdsForAttempts(ids: string[]): Promise<string[]> {
  const att = await readAttemptsDb();
  const set = new Set(ids);
  return [...new Set(att.attempts.filter((a) => set.has(a.id)).map((a) => a.exam_id))];
}
export async function examIdsForQuestions(ids: string[]): Promise<string[]> {
  const db = await readExamsDb();
  const set = new Set(ids);
  return [...new Set(db.questions.filter((q) => set.has(q.id)).map((q) => q.exam_id))];
}

export async function adminListExams(): Promise<AdminExam[]> {
  const db = await readExamsDb();
  const att = await readAttemptsDb();
  return [...db.exams]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((e) => {
      const qs = db.questions.filter((q) => q.exam_id === e.id);
      const as = att.attempts.filter((a) => a.exam_id === e.id);
      return {
        ...e,
        core_count: qs.filter((q) => q.kind === "core").length,
        optional_count_pool: qs.filter((q) => q.kind === "optional").length,
        attempts: {
          in_progress: as.filter((a) => a.status === "in_progress").length,
          submitted: as.filter((a) => a.status === "submitted").length,
          blocked: as.filter((a) => a.status === "blocked").length,
        },
      };
    });
}

export async function adminSaveExam(input: Partial<Exam>): Promise<Exam> {
  return withLock(async () => {
    const db = await readExamsDb();
    const title = (input.title ?? "").trim();
    if (!title) throw new Error("عنوان الاختبار مطلوب");
    const base: Partial<Exam> = {
      ...input,
      title,
      fields: undefined, // بيانات الدخول بتتاخد من الحساب — الحقل القديم متروك زي ما هو
      grading: input.grading === "auto" ? "auto" : input.grading === "manual" ? "manual" : undefined,
      optional_count: Math.max(0, Math.floor(Number(input.optional_count) || 0)),
      attempt_minutes: input.attempt_minutes ? Math.max(1, Math.floor(Number(input.attempt_minutes))) : null,
      ends_at: input.ends_at ? input.ends_at : null,
    };
    const now = new Date().toISOString();
    const idx = input.id ? db.exams.findIndex((e) => e.id === input.id) : -1;

    // نوع الاختبار وكلمة السر
    const prev = idx >= 0 ? db.exams[idx] : null;
    const accessType = (input.access ?? prev?.access ?? "open") as ExamAccess;
    if (!["open", "locked", "hidden"].includes(accessType)) throw new Error("نوع الاختبار غير صحيح");
    let password: string | null = input.password !== undefined ? (input.password?.trim() ? input.password.trim() : null) : (prev?.password ?? null);
    if (accessType === "open") password = null;
    else {
      if (!password || password.length < 4) throw new Error("كلمة سر الاختبار لازم تكون 4 أحرف على الأقل");
      if (db.exams.some((e) => e.id !== prev?.id && e.password && e.password === password)) {
        throw new Error("كلمة السر دي مستخدمة في اختبار تاني، اختار كلمة مختلفة");
      }
    }
    Object.assign(base, { access: accessType, password });
    for (const k of Object.keys(base) as (keyof Exam)[]) if (base[k] === undefined) delete base[k];

    if (idx >= 0) {
      db.exams[idx] = normalizeExam({ ...db.exams[idx], ...base, updated_at: now });
      await writeExamsDb(db);
      return db.exams[idx];
    }
    const created = normalizeExam({ ...base, id: undefined, created_at: now, updated_at: now });
    db.exams.push(created);
    await writeExamsDb(db);
    return created;
  });
}

export async function adminDeleteExam(id: string): Promise<void> {
  await withLock(async () => {
    const db = await readExamsDb();
    db.exams = db.exams.filter((e) => e.id !== id);
    db.questions = db.questions.filter((q) => q.exam_id !== id);
    await writeExamsDb(db);
    const att = await readAttemptsDb();
    await deleteExamImages(att.attempts.filter((a) => a.exam_id === id).flatMap((a) => Object.values(a.images).flat()));
    att.attempts = att.attempts.filter((a) => a.exam_id !== id);
    await writeAttemptsDb(att);
  });
}

export async function adminListQuestions(examId: string): Promise<Question[]> {
  const db = await readExamsDb();
  return db.questions
    .filter((q) => q.exam_id === examId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}

function cleanQuestion(input: Partial<Question>): Omit<Question, "id" | "created_at" | "sort_order"> {
  const text = (input.text ?? "").trim();
  if (!text) throw new Error("نص السؤال مطلوب");
  const type: QType = input.type === "short" || input.type === "long" ? input.type : "choice";
  const options = type === "choice" ? (input.options ?? []).map((o) => o.trim()).filter(Boolean) : [];
  if (type === "choice" && options.length < 2) throw new Error("سؤال الاختيارات محتاج اختيارين على الأقل");
  return {
    exam_id: input.exam_id ?? "",
    kind: input.kind === "optional" ? "optional" : "core",
    type,
    text,
    options,
    image_mode: input.image_mode === "optional" || input.image_mode === "required" ? input.image_mode : "none",
    max_images: Math.min(10, Math.max(1, Math.floor(Number(input.max_images) || 3))),
    model_answer: input.model_answer?.trim() ? input.model_answer.trim() : null,
    points: cleanPoints(input.points),
    correct_answer: type === "choice" && input.correct_answer && options.includes(input.correct_answer.trim()) ? input.correct_answer.trim() : null,
  };
}

function cleanPoints(v: unknown, fallback = 1): number {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback;
  return Math.min(1000, Math.max(0, Math.round(n * 100) / 100));
}

export async function adminSaveQuestion(input: Partial<Question>): Promise<Question> {
  return withLock(async () => {
    const db = await readExamsDb();
    const clean = cleanQuestion(input);
    if (!db.exams.some((e) => e.id === clean.exam_id)) throw new Error("الاختبار غير موجود");
    const idx = input.id ? db.questions.findIndex((q) => q.id === input.id) : -1;
    if (idx >= 0) {
      db.questions[idx] = { ...db.questions[idx], ...clean };
      await writeExamsDb(db);
      return db.questions[idx];
    }
    const maxOrder = Math.max(0, ...db.questions.filter((q) => q.exam_id === clean.exam_id).map((q) => q.sort_order));
    const created: Question = {
      id: crypto.randomUUID(),
      ...clean,
      sort_order: maxOrder + 1,
      created_at: new Date().toISOString(),
    };
    db.questions.push(created);
    await writeExamsDb(db);
    return created;
  });
}

export async function adminDeleteQuestions(ids: string[]): Promise<void> {
  await withLock(async () => {
    const db = await readExamsDb();
    const set = new Set(ids);
    db.questions = db.questions.filter((q) => !set.has(q.id));
    await writeExamsDb(db);
  });
}

/**
 * إضافة جماعية. الأسئلة بتتفصل بسطر فاضي. السطر الأول سؤال، وأي سطر بعده بيبدأ بـ "-" اختيار.
 * لو مفيش اختيارات السؤال بياخد النوع الافتراضي (قصير/طويل).
 */
export async function adminBulkAddQuestions(
  examId: string,
  kind: QKind,
  defaultType: "short" | "long",
  text: string,
): Promise<{ added: number }> {
  return withLock(async () => {
    const db = await readExamsDb();
    if (!db.exams.some((e) => e.id === examId)) throw new Error("الاختبار غير موجود");
    const blocks = text
      .replace(/\r/g, "")
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    let order = Math.max(0, ...db.questions.filter((q) => q.exam_id === examId).map((q) => q.sort_order));
    let added = 0;
    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const isOpt = (l: string) => /^[-•*+]\s*/.test(l);
      const qLines = lines.filter((l) => !isOpt(l));
      const optLines = lines.filter(isOpt);
      const options = optLines.map((l) => l.replace(/^[-•*+]\s*/, "").trim()).filter(Boolean);
      const correct = optLines.find((l) => l.startsWith("+"))?.replace(/^\+\s*/, "").trim() ?? null;
      const qText = qLines.join("\n").trim();
      if (!qText) continue;
      const type: QType = options.length >= 2 ? "choice" : defaultType;
      db.questions.push({
        id: crypto.randomUUID(),
        exam_id: examId,
        kind,
        type,
        text: qText,
        options: type === "choice" ? options : [],
        image_mode: "none",
        max_images: 3,
        model_answer: null,
        points: 1,
        correct_answer: type === "choice" && correct && options.includes(correct) ? correct : null,
        sort_order: ++order,
        created_at: new Date().toISOString(),
      });
      added++;
    }
    if (!added) throw new Error("مفيش أسئلة اتقرت من النص");
    await writeExamsDb(db);
    return { added };
  });
}

export type AdminAttemptRow = {
  id: string;
  exam_id: string;
  exam_title: string;
  identity: string;
  fields: Record<string, string>;
  attempt_no: number;
  status: AttemptStatus;
  submit_reason: SubmitReason | null;
  block_code: string | null;
  block_reason: BlockReason | null;
  blocked_at: string | null;
  started_at: string;
  submitted_at: string | null;
  last_seen_at: string;
  answered: number;
  total: number;
  score: number | null; // null = لسه فيه أسئلة مستنية تصحيح
  max: number;
  graded: boolean;
  user_id: string | null;
};

export async function adminListAttempts(): Promise<AdminAttemptRow[]> {
  return withLock(async () => {
    const exams = await readExamsDb();
    const attemptsDb = await readAttemptsDb();
    const now = Date.now();
    let dirty = false;
    for (const a of attemptsDb.attempts) {
      if (expireIfNeeded(a, exams.exams.find((e) => e.id === a.exam_id), now)) dirty = true;
    }
    if (dirty) await writeAttemptsDb(attemptsDb);
    const titles = new Map(exams.exams.map((e) => [e.id, e.title]));
    const qLive = new Map(exams.questions.map((q) => [q.id, q]));
    return attemptsDb.attempts
      .map((a) => ({
        id: a.id,
        exam_id: a.exam_id,
        exam_title: titles.get(a.exam_id) ?? "(اختبار محذوف)",
        identity: a.identity,
        fields: a.fields,
        attempt_no: a.attempt_no,
        status: a.status,
        submit_reason: a.submit_reason,
        block_code: a.block_code,
        block_reason: a.block_reason,
        blocked_at: a.blocked_at,
        started_at: a.started_at,
        submitted_at: a.submitted_at,
        last_seen_at: a.last_seen_at,
        answered: a.questions.filter((q) => (a.answers[q.id] ?? "").trim() || (a.images[q.id] ?? []).length > 0).length,
        total: a.questions.length,
        ...(() => {
          const g = gradeAttempt(a, exams.exams.find((e) => e.id === a.exam_id), qLive);
          return { score: g.complete || a.graded_at ? g.total : null, max: g.max, graded: isReleased(a, g), user_id: a.user_id };
        })(),
      }))
      .sort((a, b) => (b.blocked_at ?? b.started_at).localeCompare(a.blocked_at ?? a.started_at));
  });
}

export type AdminAttemptDetail = {
  attempt: Omit<Attempt, "token">;
  exam_title: string;
  items: {
    id: string;
    type: QType;
    text: string;
    options: string[];
    kind: QKind | null;
    answer: string;
    images: string[];
    image_mode: ImageMode;
    model_answer: string | null;
    points: number;
    correct_answer: string | null;
    score: number | null;
    auto: boolean; // الدرجة اتحسبت تلقائي
  }[];
  total: number;
  max: number;
  graded: boolean;
  grading: GradingMode;
};

export async function adminGetAttempt(id: string): Promise<AdminAttemptDetail | null> {
  const exams = await readExamsDb();
  const attemptsDb = await readAttemptsDb();
  const att = attemptsDb.attempts.find((a) => a.id === id);
  if (!att) return null;
  const qMap = new Map(exams.questions.map((q) => [q.id, q]));
  const { token: _t, ...rest } = att;
  const exam = exams.exams.find((e) => e.id === att.exam_id);
  const g = gradeAttempt(att, exam, qMap);
  return {
    attempt: rest,
    exam_title: exam?.title ?? "(اختبار محذوف)",
    total: g.total,
    max: g.max,
    graded: isReleased(att, g),
    grading: exam?.grading ?? "manual",
    items: att.questions.map((sq, i) => {
      const live = qMap.get(sq.id);
      return {
        points: sq.points,
        correct_answer: live?.correct_answer ?? null,
        score: g.items[i].score,
        auto: g.items[i].auto,
        id: sq.id,
        type: sq.type,
        text: sq.text,
        options: sq.options,
        kind: live?.kind ?? null,
        answer: att.answers[sq.id] ?? "",
        images: att.images[sq.id] ?? [],
        image_mode: sq.image_mode,
        model_answer: live?.model_answer ?? null,
      };
    }),
  };
}

/** فك الحظر (blocked → unblocked) — الشخص بعدها بيبدأ بأسئلة جديدة. */
export async function adminUnblock(ids: string[]): Promise<{ count: number }> {
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const set = new Set(ids);
    let count = 0;
    for (const a of attemptsDb.attempts) {
      if (set.has(a.id) && a.status === "blocked") {
        a.status = "unblocked";
        a.unblocked_at = new Date().toISOString();
        count++;
      }
    }
    if (count) await writeAttemptsDb(attemptsDb);
    return { count };
  });
}

/** السماح بمحاولة جديدة لشخص سلّم قبل كده (submitted → retired). */
export async function adminAllowRetake(ids: string[]): Promise<{ count: number }> {
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const set = new Set(ids);
    let count = 0;
    for (const a of attemptsDb.attempts) {
      if (set.has(a.id) && a.status === "submitted") {
        a.status = "retired";
        count++;
      }
    }
    if (count) await writeAttemptsDb(attemptsDb);
    return { count };
  });
}

export async function adminDeleteAttempts(ids: string[]): Promise<void> {
  await withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const set = new Set(ids);
    await deleteExamImages(attemptsDb.attempts.filter((a) => set.has(a.id)).flatMap((a) => Object.values(a.images).flat()));
    attemptsDb.attempts = attemptsDb.attempts.filter((a) => !set.has(a.id));
    await writeAttemptsDb(attemptsDb);
  });
}
