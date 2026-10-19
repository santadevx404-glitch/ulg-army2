// طبقة تخزين مفتاح/قيمة. وضعين:
//   - supabase: جدول app_kv (عمود JSONB + version) — شغال على Vercel وأي سيرفر لأنه مبيكتبش على القرص.
//   - local   : ملفات في مجلد data/ (للتطوير من غير إنترنت).
//
// اختيار الوضع (تلقائي):
//   STORAGE_MODE=supabase | local   ← لو محددها بنفسك
//   على Vercel                      ← supabase دايمًا (مفيش قرص قابل للكتابة)
//   لو SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY موجودين (في .env أو متغيرات البيئة) ← supabase
//   غير كده                         ← local
//
// الإعداد في Supabase مرة واحدة: شغّل ملف supabase/setup.sql في SQL Editor.
//
// الكتابة بتتحمي من التعارض (optimistic concurrency): كل صف ليه version، وأي عملية "اقرأ ← عدّل ← اكتب"
// جوه kvTransaction/makeLock بتتأكد إن محدش غيّر الصف في الوسط، ولو حصل بتعيد العملية من الأول.
// ده بيمنع ضياع رسايل الدردشة أو إجابات الاختبار لو سيرفرين كتبوا في نفس اللحظة.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

// ============ تحميل .env (للتشغيل المحلي) ============
// بنحمّل المتغيرات اللي مش موجودة بس. على Vercel الملفات دي مش موجودة والمتغيرات جاية من الإعدادات.
function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    try {
      const file = path.resolve(process.cwd(), name);
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        else v = v.replace(/\s+#.*$/, "");
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
      }
    } catch { /* مش مشكلة */ }
  }
}
loadDotEnv();

// ============ وضع التخزين ============
export type StorageMode = "local" | "supabase";

function pickMode(): StorageMode {
  const m = (process.env.STORAGE_MODE ?? "").trim().toLowerCase();
  if (m === "local" || m === "supabase") return m;
  if (process.env.VERCEL) return "supabase";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  return "local";
}

export const STORAGE_MODE: StorageMode = pickMode();
export const USE_LOCAL_STORAGE = STORAGE_MODE === "local";

if (!(globalThis as { __kvModeLogged?: boolean }).__kvModeLogged) {
  (globalThis as { __kvModeLogged?: boolean }).__kvModeLogged = true;
  console.log(
    USE_LOCAL_STORAGE
      ? "[storage] وضع التخزين: local (ملفات data/). للربط بـ Supabase ضيف SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في .env (راجع README)."
      : "[storage] وضع التخزين: Supabase",
  );
}

// ============ التخزين المحلي ============
const DATA_DIR = path.resolve(process.cwd(), "data");
// مفتاح -> اسم ملف داخل data/
export const LOCAL_FILES: Record<string, string> = {
  "bwd:db": "db.json",
  "bwd:users": "users.json",
  "bwd:session-secret": "session-secret.txt",
  "bwd:exams": "exams.json",
  "bwd:exam-attempts": "exam-attempts.json",
  "bwd:ranks": "ranks.json",
  "bwd:audit-log": "audit-log.json",
  "bwd:login-log": "login-log.json",
  "bwd:chats": "chats.json",
  "bwd:chat-messages": "chat-messages.json",
  "bwd:chat-uploads": "chat-uploads.json",
  "bwd:announcements": "announcements.json",
};
// ملفات بتتكتب كتير (حفظ تلقائي للإجابات) فمنعمللهاش نسخة .bak في كل كتابة
const NO_BACKUP = new Set(["bwd:exam-attempts"]);
function localPath(key: string): string {
  return path.join(DATA_DIR, LOCAL_FILES[key] ?? `${key.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}
function localRead<T>(key: string, fallback: T): T {
  const file = localPath(key);
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  if (file.endsWith(".txt")) return (raw.trim() || fallback) as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function localWrite(key: string, value: unknown): void {
  const file = localPath(key);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!NO_BACKUP.has(key) && fs.existsSync(file) && file.endsWith(".json")) fs.copyFileSync(file, `${file}.bak`);
  const out = file.endsWith(".txt") ? String(value) : JSON.stringify(value, null, 2);
  fs.writeFileSync(file, out, "utf8");
}

// ============ Supabase ============
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "متغيرات SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY مش موجودة — ضيفهم في ملف .env (محلي) أو في إعدادات المشروع على Vercel واعمل Redeploy.",
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

type PgError = { message: string; code?: string };

function mapError(e: PgError, what: string): Error {
  const msg = e.message ?? "";
  if (/version/i.test(msg) && /(column|schema cache)/i.test(msg)) {
    return new Error("عمود version مش موجود في جدول app_kv — شغّل ملف supabase/setup.sql في Supabase SQL Editor.");
  }
  if (/app_kv/.test(msg) && /(does not exist|schema cache|not find)/i.test(msg)) {
    return new Error("جدول app_kv مش موجود — شغّل ملف supabase/setup.sql في Supabase SQL Editor.");
  }
  if (/invalid api key|jwt/i.test(msg)) {
    return new Error("مفتاح Supabase غلط — تأكد إنك استخدمت الـ Secret / service_role key مش الـ Publishable.");
  }
  return new Error(`Supabase ${what} error: ${msg}`);
}

// ============ المعاملات (حماية من التعارض) ============
const txStore = new AsyncLocalStorage<Map<string, number | null>>();

export class KvConflictError extends Error {
  constructor(key: string) {
    super(`kv conflict on ${key}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** نفّذ "اقرأ ← عدّل ← اكتب". لو حد غيّر نفس الصف في الوسط، العملية بتتعاد من الأول (لحد 10 مرات). */
export async function kvTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn(); // جوه معاملة بالفعل
  if (USE_LOCAL_STORAGE) return txStore.run(new Map(), fn);
  for (let attempt = 0; ; attempt++) {
    try {
      return await txStore.run(new Map(), fn);
    } catch (e) {
      if (e instanceof KvConflictError && attempt < 9) {
        await sleep(10 + Math.random() * 40 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

/** قفل داخل السيرفر (طابور) + معاملة. كل ملف بيعمل واحد خاص بيه. */
export function makeLock() {
  let queue: Promise<unknown> = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(() => kvTransaction(fn), () => kvTransaction(fn));
    queue = run.then(() => undefined, () => undefined);
    return run;
  };
}

async function remoteRead(key: string): Promise<{ value: unknown; version: number } | null> {
  const { data, error } = await getSupabase().from("app_kv").select("value, version").eq("key", key).maybeSingle();
  if (error) throw mapError(error, "read");
  return data ? { value: data.value, version: Number(data.version) } : null;
}

export async function kvGetJSON<T>(key: string, fallback: T): Promise<T> {
  if (USE_LOCAL_STORAGE) return localRead(key, fallback);
  const row = await remoteRead(key);
  const tx = txStore.getStore();
  if (tx) tx.set(key, row ? row.version : null); // بنفتكر نسخة الصف اللي قريناه
  return row ? (row.value as T) : fallback;
}

// قراءة "للعرض بس" مشتركة بين كل الطلبات في نفس السيرفر: لو 50 شخص بيعملوا polling للدردشة،
// بدل 50 قراءة من Supabase كل ثانية بنقرا مرة واحدة ونوزّع النتيجة. أي كتابة بتمسح الكاش فورًا.
// ممنوع استخدامها جوه عمليات "اقرأ ← عدّل ← اكتب" (استخدم kvGetJSON هناك).
const sharedCache = new Map<string, { at: number; p: Promise<unknown> }>();

export function kvGetJSONShared<T>(key: string, fallback: T, ttlMs = 700): Promise<T> {
  if (USE_LOCAL_STORAGE) return Promise.resolve(localRead(key, fallback));
  const hit = sharedCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = remoteRead(key).then((row) => (row ? (row.value as T) : fallback));
  const entry = { at: Date.now(), p };
  sharedCache.set(key, entry);
  p.catch(() => { if (sharedCache.get(key) === entry) sharedCache.delete(key); });
  return p;
}

export async function kvSetJSON(key: string, value: unknown): Promise<void> {
  sharedCache.delete(key);
  if (USE_LOCAL_STORAGE) return localWrite(key, value);
  const tx = txStore.getStore();
  if (!tx) return kvTransaction(() => kvSetJSON(key, value)); // كتابة لوحدها: بتتعمل كمعاملة صغيرة
  if (!tx.has(key)) {
    const row = await remoteRead(key); // لسه ما اتقراش في المعاملة دي: بنعتمد آخر نسخة
    tx.set(key, row ? row.version : null);
  }
  const version = tx.get(key) ?? null;
  const supabase = getSupabase();
  if (version === null) {
    const { error } = await supabase.from("app_kv").insert({ key, value: value as never, version: 1 });
    if (error) {
      if (error.code === "23505") throw new KvConflictError(key); // حد تاني أنشأه قبلنا
      throw mapError(error, "write");
    }
    tx.set(key, 1);
    return;
  }
  const { data, error } = await supabase
    .from("app_kv")
    .update({ value: value as never, version: version + 1 })
    .eq("key", key)
    .eq("version", version)
    .select("version");
  if (error) throw mapError(error, "write");
  if (!data || data.length === 0) throw new KvConflictError(key); // الصف اتغيّر بعد ما قريناه
  tx.set(key, version + 1);
}

/** للفحص بس: نسخة الصف الحالية (null لو مش موجود). */
export async function kvVersion(key: string): Promise<number | null> {
  if (USE_LOCAL_STORAGE) return null;
  const row = await remoteRead(key);
  return row ? row.version : null;
}
