// نظام الاختبارات — منطق السيرفر. التخزين دلوقتي لوكال (data/exams.json و data/exam-attempts.json)
// عن طريق طبقة kv-store، وبعدين لما نربط Supabase نفس الدوال بتشتغل من غير تغيير في المنطق.
//
// ملحوظات تصميم:
//  - مفيش تصحيح تلقائي ولا درجات: الإجابات بتتحفظ بس، وانت بتراجعها من لوحة التحكم.
//  - الوقت كله بيتحسب على السيرفر (التايمر الشخصي + التايمر العام)، والتسليم الأوتوماتيك
//    بيحصل عند أي طلب بعد انتهاء الوقت، فمش معتمد على المتصفح.
//  - الشخص بيتعرّف بأول حقل في "بيانات الدخول" (مثلاً اسم الحساب).
import crypto from "node:crypto";
import { NO_ERRORS, TF_FALSE, TF_TRUE, isNoErrors, normText, parseFix, parseTfFix } from "./answer-format";
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";
import { signValue, verifySigned } from "./local-auth.server";
import { bypassesExam, normBypass, type Bypass, type Viewer } from "./bypass";
import { MAX_IMAGE_BYTES, deleteExamImages, detectImageExt, saveExamImage } from "./exam-images.server";

const EXAMS_KEY = "bwd:exams";
const ATTEMPTS_KEY = "bwd:exam-attempts";
const ARCHIVE_KEY = "bwd:exam-archive";
const GRIEVANCES_KEY = "bwd:exam-grievances";

// سماحية بسيطة (ثواني) لآخر حفظ بيوصل مع انتهاء الوقت بسبب بطء الشبكة
const SUBMIT_GRACE_MS = 15_000;

// ============================== Types ==============================

export type QType = "choice" | "short" | "long" | "tf" | "tf_fix" | "fix";
export type QKind = "core" | "optional";
export type GradingMode = "manual" | "auto";
export type ExamAccess = "open" | "locked" | "hidden";
export type ImageMode = "none" | "optional" | "required"; // none = من غير صور | optional = صور اختيارية | required = صورة إجبارية

export type Question = {
  id: string;
  exam_id: string;
  kind: QKind; // core = أساسي بيظهر للكل | optional = بيتسحب عشوائي
  type: QType; // choice = اختيارات | short/long = نصي | tf = صح/خطأ | tf_fix = صح/خطأ مع التصويب | fix = صحح المعلومة
  text: string;
  options: string[]; // للـ choice بس
  image_mode: ImageMode; // هل الشخص يقدر/لازم يرفق صور مع إجابته
  max_images: number; // أقصى عدد صور للسؤال
  model_answer: string | null; // بيظهر للأدمن بس وقت المراجعة
  points: number; // درجة السؤال
  correct_answer: string | null; // choice: نص الاختيار الصح | tf/tf_fix: "صح" أو "خطأ" | fix: الكلمة الصح اللي تتكتب مكان الغلط (للتصحيح التلقائي) — مبيظهرش للطلاب
  wrong_part: string | null; // fix بس: الكلمة/الكلمتين الغلط جوه نص السؤال
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
  tab_chances: number; // كام مرة يتسامح معاه (تحذير) قبل الحظر. 0 = حظر فوري
  tab_actions: TabAction[]; // الإجراء لكل فرصة (بالترتيب)
  exam_view: "classic" | "new"; // شكل شاشة الاختبار: classic = القديم | new = سؤال واحد وشريط أرقام
  exam_layout: "one" | "all"; // (الجديد) سؤال سؤال أو كل الأسئلة في صفحة
  allow_back: boolean; // (الجديد) السماح بالرجوع للأسئلة السابقة
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
export type TabAction = "warn" | "swap"; // تحذير فقط | تحذير + تبديل السؤال الحالي (أو تصفيره لو مفيش بديل)
/** إشعار مخالفة بيتبعت للطالب: warn = تحذير • swap = السؤال اتبدّل • zero = السؤال اتصفّر */
export type ViolationNotice = { n: number; kind: "warn" | "swap" | "zero"; used: number; total: number; qid?: string; new_qid?: string; old_text?: string; at: string };

export type Attempt = {
  id: string;
  exam_id: string;
  identity: string;
  user_id: string | null; // صاحب الحساب (الاختبارات للمسجلين بس)
  fields: Record<string, string>;
  scores: Record<string, number>; // درجات التصحيح اليدوي لكل سؤال
  feedback: Record<string, string>; // الإجابة الصح/تعليق المصحح لكل سؤال درجته أقل من الكامل
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
  violations: number; // عدد مرات تبديل التاب اللي اتحسبت
  violation_ids: string[]; // معرّفات المخالفات (لمنع العدّ المكرر)
  last_violation_at: string | null;
  notices: ViolationNotice[]; // إشعارات للطالب (تحذير/تبديل/تصفير)
  zeroed: string[]; // أسئلة اتصفّرت أوتوماتيك بسبب مخالفة
};

type ExamsDB = { exams: Exam[]; questions: Question[] };
type AttemptsDB = { attempts: Attempt[] };

// ============================== Storage ==============================

const withLock = makeLock();

function normalizeExam(e: Partial<Exam>): Exam {
  const now = new Date().toISOString();
  const chances = Math.min(20, Math.max(0, Math.floor(Number(e.tab_chances) || 0)));
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
    tab_chances: chances,
    tab_actions: Array.from({ length: chances }, (_, i) => (Array.isArray(e.tab_actions) && e.tab_actions[i] === "swap" ? "swap" : "warn") as TabAction),
    exam_view: e.exam_view === "new" ? "new" : "classic",
    exam_layout: e.exam_layout === "all" ? "all" : "one",
    allow_back: e.allow_back ?? true,
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
      wrong_part: q.wrong_part ?? null,
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
      feedback: a.feedback ?? {},
      graded_at: a.graded_at ?? null,
      graded_by: a.graded_by ?? null,
      violations: a.violations ?? 0,
      violation_ids: a.violation_ids ?? [],
      last_violation_at: a.last_violation_at ?? null,
      notices: a.notices ?? [],
      zeroed: a.zeroed ?? [],
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
    if (!allowed.has(k) || att.zeroed.includes(k)) continue; // سؤال اتصفّر = مفيش تعديل
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
  mine: { status: "in_progress" | "submitted" | "blocked"; total: number | null; max: number } | null; // حالة المستخدم الحالي
};

/** القايمة العامة: المنشور بس، والمشفّر (hidden) مبيظهرش خالص. */
export async function listPublicExams(viewer: Viewer = null): Promise<PublicExam[]> {
  const db = await readExamsDb();
  const att = viewer?.id ? (await readAttemptsDb()).attempts.filter((a) => a.user_id === viewer.id) : [];
  const live = new Map(db.questions.map((q) => [q.id, q]));
  const now = Date.now();
  return db.exams
    // المشفّر مبيظهرش غير للمستثنين من كلمة سره
    .filter((e) => e.published && (e.access !== "hidden" || bypassesExam(viewer, e.bypass)))
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
        locked: e.access === "locked" && !bypassesExam(viewer, e.bypass),
        mine: mineOf(e, viewer?.id ?? null, att, live),
      };
    });
}

/** حالة المستخدم في اختبار: آخر محاولة له ودرجتها (لو اتصححت/اتنزّلت له) */
function mineOf(e: Exam, userId: string | null, atts: Attempt[], live: Map<string, Question>): PublicExam["mine"] {
  if (!userId) return null;
  const mine = atts.filter((a) => a.exam_id === e.id && a.user_id === userId).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const a = mine[0];
  if (!a) return null;
  if (a.status === "in_progress") return { status: "in_progress", total: null, max: 0 };
  if (a.status === "blocked") return { status: "blocked", total: null, max: 0 };
  const g = gradeAttempt(a, e, live);
  const released = isReleased(a, g);
  return { status: "submitted", total: released ? g.total : null, max: g.max };
}

export type PublicExamInfo = PublicExam & {
  fields: string[];
  intro_message: string;
  question_count: number; // عدد الأسئلة اللي الشخص هيشوفها
  max_points: number; // الدرجة الكلية التقريبية
  exam_view: "classic" | "new";
};

export type PublicExamResult =
  | { state: "ok"; info: PublicExamInfo; token?: string } // token: للمستثنين من كلمة السر (بيتولّد من غير كلمة)
  | { state: "gate"; id: string; title: string | null } // لازم كلمة سر (العنوان بيظهر بس للمقفول مش المشفّر)
  | { state: "unavailable" };

const ACCESS_TTL = 60 * 60 * 12; // 12 ساعة
const ACCESS_PURPOSE = "exam-access";

async function tokenOk(examId: string, token?: string | null): Promise<boolean> {
  return (await verifySigned(ACCESS_PURPOSE, token)) === examId;
}

function toPublic(e: Exam, qs: Question[] = []): PublicExamInfo {
  const end = timeMs(e.ends_at);
  const core = qs.filter((q) => q.kind === "core");
  const pool = qs.filter((q) => q.kind === "optional");
  const take = Math.min(Math.max(0, e.optional_count), pool.length);
  const avg = pool.length ? pool.reduce((s, q) => s + q.points, 0) / pool.length : 0;
  return {
    mine: null,
    question_count: core.length + take,
    max_points: Math.round((core.reduce((s, q) => s + q.points, 0) + avg * take) * 100) / 100,
    exam_view: e.exam_view,
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
  if (exam.access === "open") return exam.published ? { state: "ok", info: toPublic(exam, db.questions.filter((q) => q.exam_id === exam.id)) } : { state: "unavailable" };
  if (!exam.published) return { state: "gate", id, title: null };
  if (await tokenOk(exam.id, token)) return { state: "ok", info: toPublic(exam, db.questions.filter((q) => q.exam_id === exam.id)) };
  // مستثنى من كلمة السر: بندّيه توكن الدخول مباشرة
  if (bypassesExam(viewer, exam.bypass)) return { state: "ok", info: toPublic(exam, db.questions.filter((q) => q.exam_id === exam.id)), token: await signValue(ACCESS_PURPOSE, exam.id, ACCESS_TTL) };
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
  | { state: "blocked"; code: string; message: string; reason?: BlockReason | null; used?: number; total?: number }
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
      tab_chances: number;
      title: string;
      view: "classic" | "new";
      layout: "one" | "all";
      allow_back: boolean;
    };

/** المستخدم المسجّل اللي بيدخل الاختبار — بياناته بتتاخد من حسابه تلقائي. */
export type ExamUser = { id: string; account_name: string; character_name: string };

const identityOf = (u: ExamUser) => `u:${u.id}`;
function fieldsOf(u: ExamUser): Record<string, string> {
  return { "اسم الحساب": u.account_name, "الاسم": u.character_name };
}

function blockedOf(att: Attempt, exam: Exam) {
  return { state: "blocked" as const, code: att.block_code ?? "", message: exam.block_message, reason: att.block_reason, used: att.violations, total: exam.tab_chances };
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
    return { result: blockedOf(blocked, exam), dirty };
  }

  const running = mine.find((a) => a.status === "in_progress");
  if (running) {
    if (!blockReentry) return { result: null, dirty };
    // دخول تاني على محاولة جارية = ريفريش/خروج → حظر
    running.status = "blocked";
    running.block_reason = "reentry";
    running.blocked_at = new Date(now).toISOString();
    running.block_code = makeBlockCode(new Set(allAttempts.map((a) => a.block_code ?? "")));
    return { result: blockedOf(running, exam), dirty: true };
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
      feedback: {},
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
      violations: 0,
      violation_ids: [],
      last_violation_at: null,
      notices: [],
      zeroed: [],
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
      tab_chances: exam.tab_chances,
      title: exam.title,
      view: exam.exam_view,
      layout: exam.exam_layout,
      allow_back: exam.allow_back,
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
  | { state: "ok"; server_now: string; used: number; total: number; notices: ViolationNotice[]; notice_count: number; questions?: ServedQuestion[]; zeroed?: string[] }
  | { state: "submitted"; message: string; reason: SubmitReason | null }
  | { state: "blocked"; code: string; message: string; reason?: BlockReason | null; used?: number; total?: number };

async function loadAttemptForClient(attemptId: string, token: string) {
  const attemptsDb = await readAttemptsDb();
  const att = attemptsDb.attempts.find((a) => a.id === attemptId);
  if (!att || att.token !== token) return null;
  const exams = await readExamsDb();
  const exam = exams.exams.find((e) => e.id === att.exam_id);
  if (!exam) return null;
  return { attemptsDb, att, exam, bank: exams.questions.filter((q) => q.exam_id === exam.id) };
}

function terminalResult(att: Attempt, exam: Exam): SaveResult | null {
  if (att.status === "blocked") return blockedOf(att, exam);
  if (att.status === "submitted") {
    return { state: "submitted", message: messageFor(exam, att.submit_reason), reason: att.submit_reason };
  }
  if (att.status !== "in_progress") return { state: "invalid" };
  return null;
}

/**
 * مخالفة تبديل تاب: لو لسه فيه فرص بتتسجّل كتحذير (وممكن تبدّل السؤال الحالي أو تصفّره)،
 * ولو الفرص خلصت بيتحظر. vid = معرّف المخالفة (نفس المخالفة ممكن توصل من أكتر من طريق فمتتعدّش مرتين).
 */
async function applyTabViolation(
  attemptsDb: AttemptsDB, att: Attempt, exam: Exam, bank: Question[], vid: string, curQid: string | undefined, nowIso: string,
): Promise<"blocked" | "recorded" | "dup"> {
  if (att.violation_ids.includes(vid)) return "dup";
  att.violation_ids = [...att.violation_ids.slice(-50), vid];
  att.violations += 1;
  att.last_violation_at = nowIso;

  if (att.violations > exam.tab_chances) {
    att.status = "blocked";
    att.block_reason = "tab_switch";
    att.blocked_at = nowIso;
    att.block_code = makeBlockCode(new Set(attemptsDb.attempts.map((a) => a.block_code ?? "")));
    att.last_saved_at = nowIso;
    return "blocked";
  }

  const base = { n: att.notices.length + 1, used: att.violations, total: exam.tab_chances, at: nowIso };
  const action: TabAction = exam.tab_actions[att.violations - 1] ?? "warn";
  if (action === "swap") {
    // السؤال اللي واقف عليه (أو أول سؤال لسه من غير إجابة)
    const live = (id?: string) => (id && att.questions.some((q) => q.id === id) && !att.zeroed.includes(id) ? id : undefined);
    const target = live(curQid) ?? att.questions.find((q) => !att.zeroed.includes(q.id) && !((att.answers[q.id] ?? "").trim()))?.id ?? att.questions.find((q) => !att.zeroed.includes(q.id))?.id;
    if (target) {
      const used = new Set([...att.questions.map((q) => q.id), ...att.notices.flatMap((n) => (n.qid ? [n.qid] : []))]);
      const pool = bank.filter((q) => !used.has(q.id));
      const pick = pool.length ? pool[crypto.randomInt(0, pool.length)] : null;
      if (pick) {
        const idx = att.questions.findIndex((q) => q.id === target);
        const oldText = att.questions[idx].text;
        att.questions = att.questions.map((q, i) => i === idx ? {
          id: pick.id, type: pick.type, text: pick.text,
          options: pick.type === "choice" ? (exam.shuffle ? shuffle(pick.options) : pick.options) : [],
          image_mode: pick.image_mode, max_images: pick.max_images, points: pick.points,
        } : q);
        const oldImgs = att.images[target] ?? [];
        const { [target]: _a, ...restAns } = att.answers; void _a;
        const { [target]: _i, ...restImg } = att.images; void _i;
        att.answers = restAns;
        att.images = restImg;
        if (oldImgs.length) await deleteExamImages(oldImgs);
        att.notices = [...att.notices, { ...base, kind: "swap", qid: target, new_qid: pick.id, old_text: oldText }];
        return "recorded";
      }
      // مفيش سؤال بديل: السؤال بياخد 0 تلقائي والطالب يكمّل على اللي بعده
      att.zeroed = [...att.zeroed, target];
      att.answers = { ...att.answers, [target]: "" };
      att.notices = [...att.notices, { ...base, kind: "zero", qid: target }];
      return "recorded";
    }
  }
  att.notices = [...att.notices, { ...base, kind: "warn" }];
  return "recorded";
}

function okResult(att: Attempt, exam: Exam, nowIso: string, seen: number): SaveResult {
  const fresh = att.notices.slice(Math.max(0, Math.floor(seen) || 0));
  return {
    state: "ok", server_now: nowIso, used: att.violations, total: exam.tab_chances,
    notices: fresh, notice_count: att.notices.length,
    ...(fresh.length ? { questions: att.questions, zeroed: att.zeroed } : {}),
  };
}

/** أقصى فجوة بين نبضتين قبل ما نعتبر الطالب سابق الصفحة (النبض كل 4 ثواني). */
const HEARTBEAT_GAP_MS = 30_000;

/** حفظ تلقائي/نبض: بيحدّث الإجابات، ولو الوقت خلص بيسلّم أوتوماتيك. */
export async function saveAnswers(
  attemptId: string,
  token: string,
  answers: Record<string, string>,
  final = false,
  leftId = "", // المتصفح بلّغ إن الطالب سابق النافذة (تبديل تاب/برنامج) — معرّف المخالفة
  curQid?: string, // السؤال اللي واقف عليه الطالب (للتبديل)
  seen = 0, // عدد الإشعارات اللي الطالب شافها
): Promise<SaveResult> {
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { state: "invalid" } as SaveResult;
    const { attemptsDb, att, exam, bank } = loaded;
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

    // حماية التبديل: (1) بلاغ من المتصفح اتأخر/اتحجب، (2) انقطاع النبض (المتصفح بيبعت كل 4 ثواني)
    // لفترة طويلة = الصفحة كانت متوقفة/مخفية أو البلاغ اتمنع. بنبلّغ الحظر في الحالتين لو الخيار شغال.
    if (exam.block_on_tab_switch) {
      const lastSeen = att.last_seen_at ? Date.parse(att.last_seen_at) : NaN;
      const gap = Number.isFinite(lastSeen) ? now - lastSeen : 0;
      let vid = String(leftId || "").slice(0, 60);
      // انقطاع النبض: بيتحسب مخالفة بس لو مفيش مخالفة اتسجّلت بالفعل من وقت آخر نبضة
      const alreadyCounted = att.last_violation_at && Number.isFinite(lastSeen) && Date.parse(att.last_violation_at) >= lastSeen;
      if (!vid && gap > HEARTBEAT_GAP_MS && !alreadyCounted) vid = `gap:${att.last_seen_at}`;
      if (vid) {
        const r = await applyTabViolation(attemptsDb, att, exam, bank, vid, curQid, nowIso);
        if (r === "blocked") {
          await writeAttemptsDb(attemptsDb);
          return terminalResult(att, exam) ?? ({ state: "invalid" } as SaveResult);
        }
      }
    }

    att.last_saved_at = nowIso;
    att.last_seen_at = nowIso;

    if (final) {
      finalize(att, "manual", now);
      await writeAttemptsDb(attemptsDb);
      return { state: "submitted", message: exam.submit_message, reason: "manual" };
    }
    await writeAttemptsDb(attemptsDb);
    return okResult(att, exam, nowIso, seen);
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
  vid?: string,
  curQid?: string,
): Promise<{ ok: boolean }> {
  return withLock(async () => {
    const loaded = await loadAttemptForClient(attemptId, token);
    if (!loaded) return { ok: false };
    const { attemptsDb, att, exam, bank } = loaded;
    if (att.status !== "in_progress") return { ok: true };

    const now = Date.now();
    if (answers) att.answers = sanitizeAnswers(att, answers);

    if (expireIfNeeded(att, exam, now)) {
      await writeAttemptsDb(attemptsDb);
      return { ok: true };
    }
    if (reason === "tab_switch" && !exam.block_on_tab_switch) return { ok: true };

    if (reason === "tab_switch") {
      // تبديل تاب: فرصة/تحذير (أو حظر لو الفرص خلصت)
      await applyTabViolation(attemptsDb, att, exam, bank, String(vid || `beacon:${now}`).slice(0, 60), curQid, new Date(now).toISOString());
      await writeAttemptsDb(attemptsDb);
      return { ok: true };
    }

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
/**
 * تصحيح تلقائي لسؤال: بيرجّع الدرجة، أو null لو محتاج تصحيح يدوي.
 *  - choice / tf: مقارنة بالإجابة الصح.
 *  - tf_fix: اختيار غلط = 0، "صح" صح = كاملة، "خطأ" صح = بيستنى تصويب يدوي.
 *  - fix: نفس الكلمة الغلط + نفس التصويب بالظبط = كاملة، غير كدا = يدوي (ممكن يكون مرادف صحيح)، ومفيش إجابة = 0.
 */
function autoScore(type: QType, rawAnswer: string, q: Question | undefined, max: number): number | null {
  const key = q?.correct_answer?.trim();
  const ans = (rawAnswer ?? "").trim();
  if (type === "fix") {
    const noneKey = key === NO_ERRORS; // الجملة صحيحة أصلًا
    if (isNoErrors(ans)) return noneKey ? max : key || q?.wrong_part ? 0 : null;
    const edits = parseFix(ans).filter((e) => e.from.trim());
    if (!edits.length) return 0; // معدّلش حاجة
    if (noneKey) return 0; // عدّل جملة صحيحة
    // لو الأدمن حدد الغلط والصح ومطابقهم بالظبط (تعديل واحد) = كاملة، غير كدا يدوي
    if (key && q?.wrong_part && edits.length === 1 && normText(edits[0].from) === normText(q.wrong_part) && normText(edits[0].to) === normText(key)) return max;
    return null;
  }
  if (!key) return null;
  if (type === "choice" || type === "tf") return ans && ans === key ? max : 0;
  if (type === "tf_fix") {
    const { verdict } = parseTfFix(ans);
    if (!verdict || verdict !== key) return 0;
    return key === TF_TRUE ? max : null;
  }
  return null;
}

/** نص "الإجابة الصح" اللي بيظهر للطالب لما التصحيح يبقى تلقائي ومش كامل. */
function autoFeedback(type: QType, q: Question | undefined): string | null {
  if (type === "fix" && q?.correct_answer === NO_ERRORS) return "الجملة صحيحة — لا يوجد أخطاء";
  if (type === "fix") return q?.correct_answer ? (q.wrong_part ? `الغلط: «${q.wrong_part}» — الصح: «${q.correct_answer}»` : q.correct_answer) : null;
  if (!q?.correct_answer) return null;
  if (type === "tf_fix") return q.model_answer ? `${q.correct_answer} — التصويب: ${q.model_answer}` : q.correct_answer;
  return q.correct_answer;
}

export function gradeAttempt(att: Attempt, exam: Exam | undefined, live: Map<string, Question>): AttemptGrade {
  const items: QGrade[] = att.questions.map((sq) => {
    const max = sq.points;
    if (att.zeroed.includes(sq.id)) return { id: sq.id, max, score: 0, auto: true }; // اتصفّر بسبب مخالفة
    const manual = att.scores[sq.id];
    if (typeof manual === "number") return { id: sq.id, max, score: Math.min(max, Math.max(0, manual)), auto: false };
    if (exam?.grading === "auto") {
      const auto = autoScore(sq.type, att.answers[sq.id] ?? "", live.get(sq.id), max);
      if (auto !== null) return { id: sq.id, max, score: auto, auto: true };
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

/** تطبيق تصحيح على محاولة (بيعدّل الـ att نفسه) — مشترك بين التسليمات الحية والأرشيف. */
function applyGrade(att: Attempt, exam: Exam | undefined, live: Map<string, Question>, scores: Record<string, unknown>, feedback: Record<string, unknown>, gradedBy: string): { total: number; max: number } {
  if (att.status !== "submitted" && att.status !== "retired") throw new Error("المحاولة لسه ماتسلّمتش");
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
  // أي سؤال درجته أقل من الكاملة (ومش متصحح تلقائي) لازم له الإجابة الصح مكتوبة
  const fb: Record<string, string> = {};
  const final0 = gradeAttempt(att, exam, live);
  for (const [i, it] of final0.items.entries()) {
    const text = String(feedback?.[it.id] ?? "").trim().slice(0, 5000);
    if ((it.score ?? 0) < it.max && !it.auto) {
      if (!text) throw new Error(`اكتب الإجابة الصح للسؤال ${i + 1} (درجته أقل من الكاملة)`);
    }
    if (text && (it.score ?? 0) < it.max) fb[it.id] = text;
  }
  att.feedback = fb;
  att.graded_at = new Date().toISOString();
  att.graded_by = gradedBy;
  const final = gradeAttempt(att, exam, live);
  return { total: final.total, max: final.max };
}

/** حفظ تصحيح محاولة: درجة لكل سؤال (0 → الحد الأقصى للسؤال). الأسئلة اللي مفيهاش درجة بتتحسب 0. لو ليها أرشيف بيتحدّث معاها. */
export async function adminGradeAttempt(id: string, scores: Record<string, unknown>, feedback: Record<string, unknown>, gradedBy: string): Promise<{ total: number; max: number }> {
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const att = attemptsDb.attempts.find((a) => a.id === id);
    if (!att) throw new Error("المحاولة غير موجودة");
    const exams = await readExamsDb();
    const exam = exams.exams.find((e) => e.id === att.exam_id);
    const live = new Map(exams.questions.map((q) => [q.id, q]));
    const res = applyGrade(att, exam, live, scores, feedback, gradedBy);
    await writeAttemptsDb(attemptsDb);
    await syncArchiveEntry(att, exam, exams.questions);
    return res;
  });
}

function verdictOf(score: number, max: number): MyResultItem["verdict"] {
  if (score >= max) return "correct";
  if (score <= 0) return "wrong";
  const r = score / max;
  return r > 0.5 ? "above" : r === 0.5 ? "half" : "below";
}

export type MyResultItem = {
  id: string;
  type: QType;
  text: string;
  options: string[];
  answer: string;
  max: number;
  score: number;
  verdict: "correct" | "above" | "half" | "below" | "wrong"; // كاملة | فوق النص | النص | تحت النص | صفر
  feedback: string | null; // الإجابة الصح / تعليق المصحح (لو الإجابة مش كاملة)
  violation: "zeroed" | "replaced" | null; // اتصفّر / اتغيّر بسبب مخالفة تبديل التاب
};
export type MyResult = {
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  view: "classic" | "new";
  attempt_no: number;
  submitted_at: string | null;
  graded: boolean;
  archived: boolean; // ليها نسخة في الأرشيف (بتفضل متاحة حتى لو اتمسحت من التسليمات)
  grievances: MyGrievance[];
  total: number | null;
  max: number;
  items: MyResultItem[]; // فاضية لو لسه ماتصححش
};
export type MyGrievance = { id: string; qid: string | null; q_text: string; message: string; status: GrievanceStatus; response: string; created_at: string; resolved_at: string | null };

function buildMyResult(a: Attempt, exam: Exam | undefined, live: Map<string, Question>, examTitle: string, archived: boolean): MyResult {
  const g = gradeAttempt(a, exam, live);
  const released = isReleased(a, g);
  return {
    attempt_id: a.id,
    exam_id: a.exam_id,
    exam_title: exam?.title ?? examTitle,
    view: exam?.exam_view ?? "classic",
    attempt_no: a.attempt_no,
    submitted_at: a.submitted_at,
    graded: released,
    archived,
    grievances: [],
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
            verdict: verdictOf(score, sq.points),
            violation: a.zeroed.includes(sq.id) ? "zeroed" : a.notices.some((n) => n.kind === "swap" && n.new_qid === sq.id) ? "replaced" : null,
            feedback: a.zeroed.includes(sq.id) ? "اتصفّر السؤال ده تلقائيًا بسبب مخالفة تبديل التبويب أثناء الاختبار." : score >= sq.points ? null : a.feedback[sq.id] || (g.items[i].auto ? autoFeedback(sq.type, live.get(sq.id)) : null),
          } satisfies MyResultItem;
        })
      : [],
  };
}

/** نتائج اختبارات المستخدم نفسه — الدرجات والصح/الغلط بتظهر بعد التصحيح بس. بتشمل المؤرشف (حتى لو اتمسح من التسليمات). */
export async function myResults(userId: string): Promise<MyResult[]> {
  const exams = await readExamsDb();
  const attemptsDb = await readAttemptsDb();
  const archive = await readArchive();
  const grievances = (await readGrievances()).filter((x) => x.user_id === userId);
  const live = new Map(exams.questions.map((q) => [q.id, q]));
  const out: MyResult[] = [];
  const seen = new Set<string>();
  for (const a of attemptsDb.attempts) {
    if (a.user_id !== userId) continue;
    if (a.status !== "submitted" && a.status !== "retired") continue;
    seen.add(a.id);
    const exam = exams.exams.find((e) => e.id === a.exam_id);
    out.push(buildMyResult(a, exam, live, "(اختبار محذوف)", archive.some((x) => x.id === a.id)));
  }
  for (const e of archive) {
    if (seen.has(e.id) || e.attempt.user_id !== userId) continue;
    const snap = new Map(Object.entries(e.live));
    out.push(buildMyResult(e.attempt, e.exam ?? undefined, snap, e.exam_title, true));
  }
  for (const r of out) r.grievances = grievances.filter((x) => x.attempt_id === r.attempt_id).map(({ id, qid, q_text, message, status, response, created_at, resolved_at }) => ({ id, qid, q_text, message, status, response, created_at, resolved_at }));
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
    const removedExam = db.exams.find((e) => e.id === id);
    const removedQuestions = db.questions.filter((q) => q.exam_id === id);
    db.exams = db.exams.filter((e) => e.id !== id);
    db.questions = db.questions.filter((q) => q.exam_id !== id);
    await writeExamsDb(db);
    const att = await readAttemptsDb();
    const doomed = att.attempts.filter((a) => a.exam_id === id);
    const kept = await archiveBeforeDelete(doomed, { exams: removedExam ? [removedExam] : [], questions: removedQuestions }, "auto_exam_delete");
    await deleteExamImages(doomed.filter((a) => !kept.has(a.id)).flatMap((a) => Object.values(a.images).flat()));
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
  const type: QType = (["short", "long", "tf", "tf_fix", "fix"] as const).find((t) => t === input.type) ?? "choice";
  const options = type === "choice" ? (input.options ?? []).map((o) => o.trim()).filter(Boolean) : [];
  if (type === "choice" && options.length < 2) throw new Error("سؤال الاختيارات محتاج اختيارين على الأقل");
  // صحح المعلومة: الغلط والصح اختياريين (للتصحيح التلقائي بس) — الطالب بيعلّم اللي يعجبه
  const wrongPart = type === "fix" ? (input.wrong_part ?? "").trim() || null : null;
  if (wrongPart && !text.includes(wrongPart)) throw new Error("الكلمة الغلط لازم تكون مكتوبة بنفس الشكل جوه نص السؤال");
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
    correct_answer: cleanCorrect(type, input.correct_answer, options),
    wrong_part: wrongPart,
  };
}

function cleanCorrect(type: QType, v: string | null | undefined, options: string[]): string | null {
  const c = (v ?? "").trim();
  if (!c) return null;
  if (type === "choice") return options.includes(c) ? c : null;
  if (type === "tf" || type === "tf_fix") return c === TF_TRUE || c === TF_FALSE ? c : null;
  if (type === "fix") return c.slice(0, 200);
  return null;
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
        wrong_part: null,
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
  violations: number;
  zeroed: number;
  archived: boolean;
  grievances_open: number;
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
    const archivedIds = new Set((await readArchive()).map((x) => x.id));
    const openG = new Map<string, number>();
    for (const x of await readGrievances()) if (x.status === "open") openG.set(x.attempt_id, (openG.get(x.attempt_id) ?? 0) + 1);
    return attemptsDb.attempts
      .map((a) => ({
        archived: archivedIds.has(a.id),
        grievances_open: openG.get(a.id) ?? 0,
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
        violations: a.violations,
        zeroed: a.zeroed.length,
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
    wrong_part: string | null;
    score: number | null;
    auto: boolean; // الدرجة اتحسبت تلقائي
    feedback: string;
    violation: "zeroed" | "replacement" | null; // اتصفّر / جه بدل سؤال اتشال بسبب مخالفة
    replaced_text: string | null; // نص السؤال اللي اتشال (لو ده سؤال بديل)
  }[];
  total: number;
  max: number;
  graded: boolean;
  grading: GradingMode;
  archived: boolean;
  grievances: Grievance[];
};

export async function adminGetAttempt(id: string): Promise<AdminAttemptDetail | null> {
  const exams = await readExamsDb();
  const attemptsDb = await readAttemptsDb();
  const att = attemptsDb.attempts.find((a) => a.id === id);
  if (!att) return null;
  const qMap = new Map(exams.questions.map((q) => [q.id, q]));
  const detail = buildAdminDetail(att, exams.exams.find((e) => e.id === att.exam_id), qMap, "(اختبار محذوف)");
  detail.archived = (await readArchive()).some((x) => x.id === id);
  detail.grievances = (await readGrievances()).filter((x) => x.attempt_id === id);
  return detail;
}

function buildAdminDetail(att: Attempt, exam: Exam | undefined, qMap: Map<string, Question>, examTitle: string): AdminAttemptDetail {
  const { token: _t, ...rest } = att;
  const g = gradeAttempt(att, exam, qMap);
  return {
    archived: false,
    grievances: [],
    attempt: rest,
    exam_title: exam?.title ?? examTitle,
    total: g.total,
    max: g.max,
    graded: isReleased(att, g),
    grading: exam?.grading ?? "manual",
    items: att.questions.map((sq, i) => {
      const live = qMap.get(sq.id);
      return {
        violation: att.zeroed.includes(sq.id) ? "zeroed" : att.notices.some((n) => n.kind === "swap" && n.new_qid === sq.id) ? "replacement" : null,
        replaced_text: att.notices.find((n) => n.kind === "swap" && n.new_qid === sq.id)?.old_text ?? null,
        points: sq.points,
        correct_answer: live?.correct_answer ?? null,
        wrong_part: live?.wrong_part ?? null,
        score: g.items[i].score,
        auto: g.items[i].auto,
        feedback: att.feedback[sq.id] ?? "",
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
    if (count) {
      await writeAttemptsDb(attemptsDb);
      const ex = await readExamsDb();
      for (const a of attemptsDb.attempts) if (set.has(a.id)) await syncArchiveEntry(a, ex.exams.find((e) => e.id === a.exam_id), ex.questions);
    }
    return { count };
  });
}

export async function adminDeleteAttempts(ids: string[]): Promise<void> {
  await withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const set = new Set(ids);
    const doomed = attemptsDb.attempts.filter((a) => set.has(a.id));
    const ex = await readExamsDb();
    const kept = await archiveBeforeDelete(doomed, ex, "auto_delete"); // المسلَّم بيتأرشف تلقائي
    await deleteExamImages(doomed.filter((a) => !kept.has(a.id)).flatMap((a) => Object.values(a.images).flat()));
    attemptsDb.attempts = attemptsDb.attempts.filter((a) => !set.has(a.id));
    await writeAttemptsDb(attemptsDb);
  });
}

// ============================== الأرشيف ==============================
// نسخة كاملة من التسليم (مع لقطة من الأسئلة والاختبار) بتفضل محفوظة حتى لو التسليم أو الاختبار اتمسح.
// الطالب بيشوف أخطاءه منها، ومحدش يقدر يمسحها غير صاحب الموقع.

export type ArchiveSource = "manual" | "auto_delete" | "auto_exam_delete";
export type ArchiveEntry = {
  id: string; // = id المحاولة
  archived_at: string;
  updated_at: string;
  source: ArchiveSource;
  exam_title: string;
  exam: Exam | null; // لقطة من إعدادات الاختبار (نظام التصحيح وشكل العرض)
  live: Record<string, Question>; // لقطة من الأسئلة (الإجابات الصح)
  attempt: Attempt;
};

async function readArchive(): Promise<ArchiveEntry[]> {
  return (await kvGetJSON<ArchiveEntry[]>(ARCHIVE_KEY, [])).map((e) => ({ ...e, live: e.live ?? {}, attempt: { ...e.attempt, images: e.attempt.images ?? {}, scores: e.attempt.scores ?? {}, feedback: e.attempt.feedback ?? {}, notices: e.attempt.notices ?? [], zeroed: e.attempt.zeroed ?? [], violation_ids: e.attempt.violation_ids ?? [] } }));
}
async function writeArchive(list: ArchiveEntry[]) {
  await kvSetJSON(ARCHIVE_KEY, list);
}

function snapshotLive(att: Attempt, questions: Question[], old: Record<string, Question> = {}): Record<string, Question> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Record<string, Question> = {};
  for (const sq of att.questions) {
    const q = byId.get(sq.id) ?? old[sq.id];
    if (q) out[sq.id] = q;
  }
  return out;
}

/** عمل/تحديث نسخة أرشيف لمحاولة. (لازم يتنادى جوه withLock) */
async function upsertArchive(att: Attempt, exam: Exam | undefined, questions: Question[], source: ArchiveSource): Promise<void> {
  if (att.status !== "submitted" && att.status !== "retired") return;
  const list = await readArchive();
  const i = list.findIndex((e) => e.id === att.id);
  const now = new Date().toISOString();
  const old = i >= 0 ? list[i] : null;
  const entry: ArchiveEntry = {
    id: att.id,
    archived_at: old?.archived_at ?? now,
    updated_at: now,
    source: old?.source ?? source,
    exam_title: exam?.title ?? old?.exam_title ?? "(اختبار محذوف)",
    exam: exam ?? old?.exam ?? null,
    live: snapshotLive(att, questions, old?.live),
    attempt: JSON.parse(JSON.stringify(att)) as Attempt,
  };
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await writeArchive(list);
}

/** لو للمحاولة أرشيف، بنحدّثه معاها (تصحيح/تعديل). (جوه withLock) */
async function syncArchiveEntry(att: Attempt, exam: Exam | undefined, questions: Question[]): Promise<void> {
  const list = await readArchive();
  if (!list.some((e) => e.id === att.id)) return;
  await upsertArchive(att, exam, questions, "manual");
}

/** قبل مسح تسليمات: بيأرشف المسلَّم منها. بيرجّع ids اللي اتأرشفت (صورها مبتتمسحش). (جوه withLock) */
async function archiveBeforeDelete(doomed: Attempt[], ex: ExamsDB, source: ArchiveSource): Promise<Set<string>> {
  const kept = new Set<string>();
  const list = await readArchive();
  const had = new Set(list.map((e) => e.id));
  for (const a of doomed) {
    if (a.status !== "submitted" && a.status !== "retired") continue;
    await upsertArchive(a, ex.exams.find((e) => e.id === a.exam_id), ex.questions, source);
    kept.add(a.id);
  }
  for (const id of had) kept.add(id);
  return kept;
}

export async function adminArchiveAttempts(ids: string[]): Promise<{ count: number }> {
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const ex = await readExamsDb();
    const set = new Set(ids);
    let count = 0;
    for (const a of attemptsDb.attempts) {
      if (!set.has(a.id) || (a.status !== "submitted" && a.status !== "retired")) continue;
      await upsertArchive(a, ex.exams.find((e) => e.id === a.exam_id), ex.questions, "manual");
      count++;
    }
    return { count };
  });
}

export type ArchiveRow = {
  id: string;
  exam_id: string;
  exam_title: string;
  identity: string;
  fields: Record<string, string>;
  user_id: string | null;
  attempt_no: number;
  submitted_at: string | null;
  archived_at: string;
  updated_at: string;
  source: ArchiveSource;
  in_submissions: boolean; // لسه موجود في التسليمات
  score: number | null;
  max: number;
  graded: boolean;
  grievances_open: number;
  grievances_total: number;
};

export async function adminListArchive(): Promise<ArchiveRow[]> {
  const list = await readArchive();
  const live = new Set((await readAttemptsDb()).attempts.map((a) => a.id));
  const gr = await readGrievances();
  return list
    .map((e) => {
      const g = gradeAttempt(e.attempt, e.exam ?? undefined, new Map(Object.entries(e.live)));
      const mine = gr.filter((x) => x.attempt_id === e.id);
      return {
        id: e.id,
        exam_id: e.attempt.exam_id,
        exam_title: e.exam_title,
        identity: e.attempt.identity,
        fields: e.attempt.fields,
        user_id: e.attempt.user_id,
        attempt_no: e.attempt.attempt_no,
        submitted_at: e.attempt.submitted_at,
        archived_at: e.archived_at,
        updated_at: e.updated_at,
        source: e.source,
        in_submissions: live.has(e.id),
        score: g.complete || e.attempt.graded_at ? g.total : null,
        max: g.max,
        graded: isReleased(e.attempt, g),
        grievances_open: mine.filter((x) => x.status === "open").length,
        grievances_total: mine.length,
      } satisfies ArchiveRow;
    })
    .sort((a, b) => b.archived_at.localeCompare(a.archived_at));
}

export async function adminGetArchive(id: string): Promise<AdminAttemptDetail | null> {
  const e = (await readArchive()).find((x) => x.id === id);
  if (!e) return null;
  const detail = buildAdminDetail(e.attempt, e.exam ?? undefined, new Map(Object.entries(e.live)), e.exam_title);
  detail.archived = true;
  detail.grievances = (await readGrievances()).filter((x) => x.attempt_id === id);
  return detail;
}

/** تصحيح نسخة الأرشيف: لو التسليم لسه موجود بيتصحح هو والأرشيف بيتحدّث، وإلا بيتعدّل الأرشيف نفسه. */
export async function adminGradeArchive(id: string, scores: Record<string, unknown>, feedback: Record<string, unknown>, gradedBy: string): Promise<{ total: number; max: number }> {
  const liveExists = (await readAttemptsDb()).attempts.some((a) => a.id === id);
  if (liveExists) return adminGradeAttempt(id, scores, feedback, gradedBy);
  return withLock(async () => {
    const list = await readArchive();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error("النسخة غير موجودة في الأرشيف");
    const res = applyGrade(e.attempt, e.exam ?? undefined, new Map(Object.entries(e.live)), scores, feedback, gradedBy);
    e.updated_at = new Date().toISOString();
    await writeArchive(list);
    return res;
  });
}

/** استرجاع من الأرشيف للتسليمات (ولو regrade: بيتمسح التصحيح عشان يتصحح من جديد). النسخة بتفضل في الأرشيف. */
export async function adminRestoreArchive(id: string, regrade: boolean): Promise<{ restored: boolean }> {
  return withLock(async () => {
    const list = await readArchive();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error("النسخة غير موجودة في الأرشيف");
    const attemptsDb = await readAttemptsDb();
    let att = attemptsDb.attempts.find((a) => a.id === id);
    let restored = false;
    if (!att) {
      att = { ...JSON.parse(JSON.stringify(e.attempt)), token: crypto.randomBytes(24).toString("hex") } as Attempt;
      att.status = "submitted";
      attemptsDb.attempts.push(att);
      restored = true;
    }
    if (regrade) {
      att.scores = {};
      att.feedback = {};
      att.graded_at = null;
      att.graded_by = null;
    }
    await writeAttemptsDb(attemptsDb);
    const ex = await readExamsDb();
    await upsertArchive(att, ex.exams.find((x) => x.id === att!.exam_id) ?? e.exam ?? undefined, ex.questions, "manual");
    return { restored };
  });
}

/** مسح نهائي من الأرشيف — صاحب الموقع بس (الفحص في طبقة الـ fn). */
export async function ownerDeleteArchive(ids: string[]): Promise<{ count: number }> {
  return withLock(async () => {
    const list = await readArchive();
    const set = new Set(ids);
    const doomed = list.filter((e) => set.has(e.id));
    const liveIds = new Set((await readAttemptsDb()).attempts.map((a) => a.id));
    await deleteExamImages(doomed.filter((e) => !liveIds.has(e.id)).flatMap((e) => Object.values(e.attempt.images).flat()));
    await writeArchive(list.filter((e) => !set.has(e.id)));
    return { count: doomed.length };
  });
}

// ============================== التظلمات ==============================

export type GrievanceStatus = "open" | "accepted" | "rejected";
export type Grievance = {
  id: string;
  attempt_id: string;
  exam_id: string;
  exam_title: string;
  user_id: string;
  identity: string;
  qid: string | null; // السؤال المتظلَّم عليه (null = تظلم عام)
  q_text: string;
  message: string;
  status: GrievanceStatus;
  response: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

async function readGrievances(): Promise<Grievance[]> {
  return kvGetJSON<Grievance[]>(GRIEVANCES_KEY, []);
}
async function writeGrievances(list: Grievance[]) {
  await kvSetJSON(GRIEVANCES_KEY, list);
}

/** الطالب بيتظلم على سؤال (أو تظلم عام) في تسليم بتاعه — سواء لسه في التسليمات أو متأرشف. */
export async function createGrievance(userId: string, attemptId: string, qid: string | null, message: string): Promise<Grievance> {
  const msg = String(message ?? "").trim().slice(0, 1500);
  if (msg.length < 3) throw new Error("اكتب سبب التظلم");
  return withLock(async () => {
    const attemptsDb = await readAttemptsDb();
    const ex = await readExamsDb();
    let att = attemptsDb.attempts.find((a) => a.id === attemptId);
    let exam = att ? ex.exams.find((e) => e.id === att!.exam_id) : undefined;
    let qMap = new Map(ex.questions.map((q) => [q.id, q]));
    let title = exam?.title ?? "(اختبار محذوف)";
    if (!att) {
      const e = (await readArchive()).find((x) => x.id === attemptId);
      if (e) {
        att = e.attempt;
        exam = e.exam ?? undefined;
        qMap = new Map(Object.entries(e.live));
        title = e.exam_title;
      }
    }
    if (!att || att.user_id !== userId) throw new Error("التسليم غير موجود");
    if (!isReleased(att, gradeAttempt(att, exam, qMap))) throw new Error("النتيجة لسه ماظهرتش");
    let qText = "تظلم عام على التسليم";
    if (qid) {
      const sq = att.questions.find((q) => q.id === qid);
      if (!sq) throw new Error("السؤال غير موجود في التسليم");
      qText = sq.text;
    }
    const list = await readGrievances();
    if (list.some((g) => g.attempt_id === attemptId && g.qid === (qid ?? null) && g.status === "open")) throw new Error("عندك تظلم مفتوح على نفس السؤال بالفعل");
    if (list.filter((g) => g.attempt_id === attemptId && g.status === "open").length >= 30) throw new Error("وصلت للحد الأقصى من التظلمات المفتوحة");
    const g: Grievance = {
      id: crypto.randomUUID(), attempt_id: attemptId, exam_id: att.exam_id, exam_title: title, user_id: userId,
      identity: att.identity, qid: qid ?? null, q_text: qText.slice(0, 400), message: msg, status: "open", response: "",
      created_at: new Date().toISOString(), resolved_at: null, resolved_by: null,
    };
    list.push(g);
    await writeGrievances(list);
    return g;
  });
}

export async function adminListGrievances(): Promise<Grievance[]> {
  return (await readGrievances()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function grievanceExamIds(ids: string[]): Promise<string[]> {
  const set = new Set(ids);
  return [...new Set((await readGrievances()).filter((g) => set.has(g.id)).map((g) => g.exam_id))];
}

export async function adminResolveGrievance(id: string, status: "open" | "accepted" | "rejected", response: string, by: string): Promise<Grievance> {
  return withLock(async () => {
    const list = await readGrievances();
    const g = list.find((x) => x.id === id);
    if (!g) throw new Error("التظلم غير موجود");
    g.status = status;
    g.response = String(response ?? "").trim().slice(0, 1500);
    g.resolved_at = status === "open" ? null : new Date().toISOString();
    g.resolved_by = status === "open" ? null : by;
    await writeGrievances(list);
    return g;
  });
}

export async function archiveExamIds(ids: string[]): Promise<string[]> {
  const set = new Set(ids);
  return [...new Set((await readArchive()).filter((e) => set.has(e.id)).map((e) => e.attempt.exam_id))];
}
