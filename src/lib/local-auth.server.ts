// نظام حسابات محلي بالكامل (بدون Supabase وبدون أي خدمة خارجية).
// الحسابات بتتحفظ في data/users.json، وأي حساب بيتعمل بيبقى مدير (admin)
// تلقائيًا — لأن اللوحة دي مخصصة لصاحب/مطور الموقع بس.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SECRET_FILE = path.join(DATA_DIR, "session-secret.txt");

export type User = {
  id: string;
  email: string;
  passwordHash: string; // "salt:hash" (scrypt)
  role: "admin";
  created_at: string;
};

let writeQueue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readUsers(): Promise<User[]> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  let raw: string;
  try {
    raw = await fs.readFile(USERS_FILE, "utf-8");
  } catch {
    await fs.writeFile(USERS_FILE, "[]", "utf-8");
    return [];
  }
  try {
    return JSON.parse(raw) as User[];
  } catch {
    // الملف موجود بس اتلف — نعمل نسخة احتياطية بدل ما نمسحه
    const backupPath = path.join(DATA_DIR, `users.corrupted.${Date.now()}.json`);
    try {
      await fs.writeFile(backupPath, raw, "utf-8");
    } catch {
      // تجاهل
    }
    await fs.writeFile(USERS_FILE, "[]", "utf-8");
    return [];
  }
}

async function writeUsers(users: User[]): Promise<void> {
  const tmpPath = `${USERS_FILE}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(users, null, 2), "utf-8");
  await fs.rename(tmpPath, USERS_FILE);
}

// سر توقيع الجلسات: بيتولد أوتوماتيك أول مرة ويتحفظ في ملف محلي —
// مفيش حاجة تتظبط يدويًا ومفيش خدمة خارجية.
async function getSecret(): Promise<string> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const s = await fs.readFile(SECRET_FILE, "utf-8");
    return s.trim();
  } catch {
    const secret = crypto.randomBytes(48).toString("hex");
    await fs.writeFile(SECRET_FILE, secret, "utf-8");
    return secret;
  }
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")): string {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(hash, "hex");
  if (check.length !== original.length) return false;
  return crypto.timingSafeEqual(check, original);
}

export async function signup(email: string, password: string): Promise<{ error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) return { error: "الإيميل مش صحيح" };
  if (!password || password.length < 6) return { error: "كلمة المرور لازم تكون 6 أحرف على الأقل" };

  return withLock(async () => {
    const users = await readUsers();
    if (users.some((u) => u.email === cleanEmail)) {
      return { error: "الحساب ده موجود بالفعل، سجّل دخول بدل كده" };
    }
    users.push({
      id: crypto.randomUUID(),
      email: cleanEmail,
      passwordHash: hashPassword(password),
      role: "admin",
      created_at: new Date().toISOString(),
    });
    await writeUsers(users);
    return {};
  });
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const cleanEmail = email.trim().toLowerCase();
  const users = await readUsers();
  const user = users.find((u) => u.email === cleanEmail);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export const SESSION_COOKIE = "bwd_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 يوم بالثواني

export async function createSessionToken(userId: string): Promise<string> {
  const secret = await getSecret();
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!userId || !exp || Number.isNaN(exp) || Date.now() > exp) return null;

  const secret = await getSecret();
  const expected = crypto.createHmac("sha256", secret).update(`${userId}.${expStr}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return userId;
}
