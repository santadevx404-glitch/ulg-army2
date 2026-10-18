// نظام الحسابات. التخزين عن طريق kv-store (ملفات data/ دلوقتي، وSupabase بعدين).
//
//  - صاحب الموقع (OWNER_EMAIL) هو الأدمن الأساسي: بيعدّي على كل الصلاحيات ومفيش حد يقدر يعدّل عليه.
//  - أي حد تاني بيعمل "طلب حساب" (status = pending)، والإدارة بتقبله وتديه رتبة أو ترفضه.
//  - الصلاحيات نفسها مش هنا: الرتبة + صلاحيات الشخص الفردية (راجع access.server.ts).
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON, kvTransaction, USE_LOCAL_STORAGE, makeLock } from "./kv-store.server";
import { sanitizeKeys } from "./permissions";

const USERS_KEY = "bwd:users";
const SECRET_KEY = "bwd:session-secret";

export const OWNER_EMAIL = "santadevx404@gmail.com";

// ============ حساب المطور المحلي ============
// في الوضع المحلي بيتأكد إن حساب صاحب الموقع موجود (ولو لسه كلمة سره الافتراضية بيصلّحها).
// لو غيّرت كلمة السر من صفحة "حسابي" بتتثبت ومبتتغيرش تاني.
const LOCAL_DEV_EMAIL = OWNER_EMAIL;
const LOCAL_DEV_PASSWORD = "m1172009";

export type UserStatus = "pending" | "active" | "rejected" | "disabled";

export type User = {
  id: string;
  email: string;
  passwordHash: string; // "salt:hash" (scrypt)
  role: "admin" | "member"; // قديم — محتفظين بيه للتوافق
  created_at: string;
  status: UserStatus;
  account_name: string;
  character_name: string;
  military_code: string;
  rank_requested: string; // الرتبة اللي الشخص كتبها في الطلب (للعرض بس)
  rank_ids: string[]; // الرتب الفعلية (بتحدد الصلاحيات) — ممكن أكتر من رتبة
  grants: string[]; // صلاحيات إضافية فردية
  denies: string[]; // صلاحيات ممنوعة رغم الرتب
  hidden: boolean; // مخفي من قايمة الأعضاء (الأدمن الأساسي بس هو اللي يشوفه)
  display_title: string | null; // اللقب اللي بيظهر للأدمن الأساسي بدل "الأدمن الأساسي"
  avatar: string | null; // اسم ملف صورة البروفايل
  password_changed: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reject_reason: string | null;
};

export function normalizeUser(u: Partial<User>): User {
  const email = String(u.email ?? "").toLowerCase();
  return {
    id: u.id ?? crypto.randomUUID(),
    email,
    passwordHash: u.passwordHash ?? "",
    role: email === OWNER_EMAIL ? "admin" : "member",
    created_at: u.created_at ?? new Date().toISOString(),
    status: u.status ?? "active", // الحسابات القديمة كانت كلها active
    account_name: u.account_name ?? "",
    character_name: u.character_name ?? "",
    military_code: u.military_code ?? "",
    rank_requested: u.rank_requested ?? "",
    rank_ids: Array.isArray(u.rank_ids)
      ? u.rank_ids
      : (u as { rank_id?: string | null }).rank_id
        ? [(u as { rank_id?: string | null }).rank_id as string]
        : [],
    grants: sanitizeKeys(u.grants),
    denies: sanitizeKeys(u.denies),
    hidden: u.hidden ?? false,
    display_title: u.display_title ?? null,
    avatar: u.avatar ?? null,
    password_changed: u.password_changed ?? false,
    reviewed_at: u.reviewed_at ?? null,
    reviewed_by: u.reviewed_by ?? null,
    reject_reason: u.reject_reason ?? null,
  };
}

export function isOwner(u: Pick<User, "email">): boolean {
  return u.email === OWNER_EMAIL;
}

const withLock = makeLock();

async function readUsers(): Promise<User[]> {
  const raw = await kvGetJSON<Partial<User>[]>(USERS_KEY, []);
  return raw.map(normalizeUser);
}

async function writeUsers(users: User[]): Promise<void> {
  await kvSetJSON(USERS_KEY, users);
}

// سر توقيع الجلسات: بيتولد أوتوماتيك أول مرة ويتحفظ.
async function getSecret(): Promise<string> {
  const existing = await kvGetJSON<string | null>(SECRET_KEY, null);
  if (existing) return existing;
  // لو سيرفرين أنشأوه في نفس اللحظة، واحد بس بيكسب والتاني بيقرا اللي اتكتب
  return kvTransaction(async () => {
    const again = await kvGetJSON<string | null>(SECRET_KEY, null);
    if (again) return again;
    const secret = crypto.randomBytes(48).toString("hex");
    await kvSetJSON(SECRET_KEY, secret);
    return secret;
  });
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================== تسجيل صاحب الموقع ==============================

/** إنشاء حساب صاحب الموقع (مسموح للإيميل ده بس). أي حد تاني بيستخدم طلب الحساب. */
export async function signup(email: string, password: string): Promise<{ error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail !== OWNER_EMAIL) {
    return { error: "التسجيل المباشر مقفول — استخدم «طلب إنشاء حساب» وهيتراجع من الإدارة" };
  }
  if (!password || password.length < 6) return { error: "كلمة المرور لازم تكون 6 أحرف على الأقل" };

  return withLock(async () => {
    const users = await readUsers();
    if (users.some((u) => u.email === cleanEmail)) {
      return { error: "الحساب ده موجود بالفعل، سجّل دخول بدل كده" };
    }
    users.push(
      normalizeUser({
        id: crypto.randomUUID(),
        email: cleanEmail,
        passwordHash: hashPassword(password),
        status: "active",
        password_changed: true,
      }),
    );
    await writeUsers(users);
    return {};
  });
}

async function ensureLocalDevUser(): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const existing = users.find((u) => u.email === LOCAL_DEV_EMAIL);
    if (existing) {
      let dirty = false;
      if (existing.status !== "active") { existing.status = "active"; dirty = true; }
      if (!existing.password_changed && !verifyPassword(LOCAL_DEV_PASSWORD, existing.passwordHash)) {
        existing.passwordHash = hashPassword(LOCAL_DEV_PASSWORD);
        dirty = true;
      }
      if (dirty) await writeUsers(users);
      return;
    }
    users.push(
      normalizeUser({
        id: crypto.randomUUID(),
        email: LOCAL_DEV_EMAIL,
        passwordHash: hashPassword(LOCAL_DEV_PASSWORD),
        status: "active",
      }),
    );
    await writeUsers(users);
  });
}

// ============================== طلب إنشاء حساب ==============================

export type AccountRequestInput = {
  account_name: string;
  character_name: string;
  military_code: string;
  rank_requested: string;
  email: string;
  password: string;
};

const recentRequests: number[] = [];
const MAX_PENDING = 300;

export async function requestAccount(input: AccountRequestInput): Promise<{ error?: string }> {
  const clean = (v: unknown, max = 80) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const account_name = clean(input.account_name);
  const character_name = clean(input.character_name);
  const military_code = clean(input.military_code, 40);
  const rank_requested = clean(input.rank_requested, 60);
  const email = clean(input.email, 120).toLowerCase();
  const password = String(input.password ?? "");

  if (!account_name || !character_name || !military_code || !rank_requested || !email || !password) {
    return { error: "املأ كل الحقول" };
  }
  if (!EMAIL_RE.test(email)) return { error: "الإيميل مش صحيح" };
  if (account_name.includes("@")) return { error: "اسم الحساب مينفعش يحتوي على @" };
  if (password.length < 6) return { error: "كلمة المرور لازم تكون 6 أحرف على الأقل" };
  if (password.length > 128) return { error: "كلمة المرور طويلة جدًا" };
  if (email === OWNER_EMAIL) return { error: "الإيميل ده مستخدم بالفعل" };

  // حماية بسيطة من الإغراق: 10 طلبات في الدقيقة على مستوى الموقع كله
  const now = Date.now();
  while (recentRequests.length && now - recentRequests[0] > 60_000) recentRequests.shift();
  if (recentRequests.length >= 10) return { error: "طلبات كتير في وقت قصير، حاول بعد دقيقة" };
  recentRequests.push(now);

  return withLock(async () => {
    const users = await readUsers();
    const lower = account_name.toLowerCase();
    const blocking = users.filter((u) => u.status !== "rejected");
    if (blocking.some((u) => u.email === email)) return { error: "الإيميل ده مستخدم بالفعل أو عليه طلب قيد المراجعة" };
    if (blocking.some((u) => u.account_name.toLowerCase() === lower)) return { error: "اسم الحساب ده مستخدم بالفعل أو عليه طلب قيد المراجعة" };
    if (users.filter((u) => u.status === "pending").length >= MAX_PENDING) {
      return { error: "عدد الطلبات المعلقة وصل للحد الأقصى، حاول لاحقًا" };
    }
    // لو كان فيه طلب مرفوض قديم لنفس الإيميل بنستبدله بالطلب الجديد
    const kept = users.filter((u) => !(u.status === "rejected" && u.email === email));
    kept.push(
      normalizeUser({
        id: crypto.randomUUID(),
        email,
        passwordHash: hashPassword(password),
        status: "pending",
        account_name,
        character_name,
        military_code,
        rank_requested,
      }),
    );
    await writeUsers(kept);
    return {};
  });
}

// ============================== الدخول والجلسات ==============================

export type LoginResult =
  | { ok: true; user: User; method: "email" | "account_name" }
  | { ok: false; error: string; reason: "unknown" | "wrong_password" | "pending" | "rejected" | "disabled"; user: User | null; method: "email" | "account_name" };

const normName = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

/** الدخول بالإيميل أو باسم الحساب. */
export async function verifyLogin(identifier: string, password: string): Promise<LoginResult> {
  if (USE_LOCAL_STORAGE) await ensureLocalDevUser();
  const id = String(identifier ?? "").trim();
  const method = id.includes("@") ? ("email" as const) : ("account_name" as const);
  const users = await readUsers();
  let user: User | undefined;
  if (method === "email") {
    user = users.find((u) => u.email === id.toLowerCase());
  } else {
    const n = normName(id);
    const matches = n ? users.filter((u) => u.account_name && normName(u.account_name) === n) : [];
    user = matches.find((u) => u.status !== "rejected") ?? matches[0];
  }
  if (!user || !verifyPassword(String(password ?? ""), user.passwordHash)) {
    return { ok: false, error: "بيانات الدخول غلط", reason: user ? "wrong_password" : "unknown", user: user ?? null, method };
  }
  if (user.status === "pending") return { ok: false, error: "طلب إنشاء حسابك لسه قيد المراجعة من الإدارة", reason: "pending", user, method };
  if (user.status === "rejected") {
    return { ok: false, error: user.reject_reason ? `تم رفض طلبك: ${user.reject_reason}` : "تم رفض طلب إنشاء حسابك", reason: "rejected", user, method };
  }
  if (user.status === "disabled") return { ok: false, error: "الحساب موقوف، تواصل مع الإدارة", reason: "disabled", user, method };
  return { ok: true, user, method };
}

export async function getUserById(id: string): Promise<User | null> {
  const users = await readUsers();
  return users.find((u) => u.id === id) ?? null;
}

export async function listUsers(): Promise<User[]> {
  return readUsers();
}

export async function changeOwnPassword(id: string, oldPassword: string, newPassword: string): Promise<{ error?: string }> {
  if (!newPassword || newPassword.length < 6) return { error: "كلمة المرور الجديدة لازم تكون 6 أحرف على الأقل" };
  if (newPassword.length > 128) return { error: "كلمة المرور طويلة جدًا" };
  return withLock(async () => {
    const users = await readUsers();
    const u = users.find((x) => x.id === id);
    if (!u) return { error: "الحساب غير موجود" };
    if (!verifyPassword(oldPassword, u.passwordHash)) return { error: "كلمة المرور الحالية غلط" };
    u.passwordHash = hashPassword(newPassword);
    u.password_changed = true;
    await writeUsers(users);
    return {};
  });
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

// توكنات موقّعة قصيرة العمر (بتستخدم لفتح الاختبارات المقفولة بكلمة سر)
export async function signValue(purpose: string, value: string, ttlSeconds: number): Promise<string> {
  const secret = await getSecret();
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${purpose}.${value}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${value}.${exp}.${sig}`).toString("base64url");
}

/** بيرجع القيمة لو التوقيع سليم والغرض صح ولسه مخلصش. */
export async function verifySigned(purpose: string, token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  let raw: string;
  try { raw = Buffer.from(token, "base64url").toString("utf8"); } catch { return null; }
  const parts = raw.split(".");
  if (parts.length < 3) return null;
  const sig = parts[parts.length - 1];
  const exp = Number(parts[parts.length - 2]);
  const value = parts.slice(0, -2).join(".");
  if (!exp || Date.now() > exp) return null;
  const secret = await getSecret();
  const expected = crypto.createHmac("sha256", secret).update(`${purpose}.${value}.${exp}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

// ============================== عمليات الإدارة ==============================
// الفحص الأمني (مين مسموحله) بيحصل في الطبقة اللي فوق (access.server.ts + account-fns.ts).
// هنا بس حماية صاحب الموقع من أي تعديل.

function mustFind(users: User[], id: string): User {
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error("الحساب غير موجود");
  return u;
}
function notOwner(u: User) {
  if (isOwner(u)) throw new Error("مينفعش التعديل على الأدمن الأساسي");
}

export async function approveRequest(id: string, rankIds: string[], reviewerId: string): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    if (u.status !== "pending") throw new Error("الطلب ده اتراجع قبل كده");
    u.status = "active";
    u.rank_ids = rankIds;
    u.reviewed_at = new Date().toISOString();
    u.reviewed_by = reviewerId;
    u.reject_reason = null;
    await writeUsers(users);
  });
}

export async function rejectRequest(id: string, reason: string, reviewerId: string): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    if (u.status !== "pending") throw new Error("الطلب ده اتراجع قبل كده");
    u.status = "rejected";
    u.reject_reason = reason.trim().slice(0, 300) || null;
    u.reviewed_at = new Date().toISOString();
    u.reviewed_by = reviewerId;
    await writeUsers(users);
  });
}

export async function setUserStatus(id: string, status: "active" | "disabled"): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    if (u.status !== "active" && u.status !== "disabled") throw new Error("الحساب ده مش مفعّل");
    u.status = status;
    await writeUsers(users);
  });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 6) throw new Error("كلمة المرور لازم تكون 6 أحرف على الأقل");
  if (newPassword.length > 128) throw new Error("كلمة المرور طويلة جدًا");
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    u.passwordHash = hashPassword(newPassword);
    u.password_changed = true;
    await writeUsers(users);
  });
}

export async function deleteUser(id: string): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    await writeUsers(users.filter((x) => x.id !== id));
  });
}

export async function updateUserDetails(
  id: string,
  d: { account_name: string; character_name: string; military_code: string },
): Promise<void> {
  const clean = (v: unknown, max = 80) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const account_name = clean(d.account_name);
  const character_name = clean(d.character_name);
  const military_code = clean(d.military_code, 40);
  if (!account_name || !character_name || !military_code) throw new Error("املأ كل الحقول");
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    if (users.some((x) => x.id !== id && x.status !== "rejected" && x.account_name.toLowerCase() === account_name.toLowerCase())) {
      throw new Error("اسم الحساب ده مستخدم بالفعل");
    }
    u.account_name = account_name;
    u.character_name = character_name;
    u.military_code = military_code;
    await writeUsers(users);
  });
}

export async function updateUserAssignments(
  id: string,
  a: { rank_ids: string[]; grants: string[]; denies: string[] },
): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    u.rank_ids = a.rank_ids;
    u.grants = a.grants;
    u.denies = a.denies;
    await writeUsers(users);
  });
}

/** بيضيف صلاحيات فردية (مثلاً صلاحية على اختبار لسه عامله الشخص ده بنفسه). */
export async function addGrants(id: string, keys: string[]): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = users.find((x) => x.id === id);
    if (!u || isOwner(u)) return;
    u.grants = [...new Set([...u.grants, ...keys])];
    await writeUsers(users);
  });
}

/** لما رتبة تتمسح، كل اللي كانت معاهم بيفقدوها. */
export async function clearRankFromUsers(rankId: string): Promise<number> {
  return withLock(async () => {
    const users = await readUsers();
    let n = 0;
    for (const u of users) {
      if (u.rank_ids.includes(rankId)) { u.rank_ids = u.rank_ids.filter((r) => r !== rankId); n++; }
    }
    if (n) await writeUsers(users);
    return n;
  });
}

export async function countPendingRequests(): Promise<number> {
  return (await readUsers()).filter((u) => u.status === "pending").length;
}

/** إخفاء/إظهار عضو من قايمة الأعضاء (الأدمن الأساسي بس — الفحص في الطبقة اللي فوق). */
export async function setUserHidden(id: string, hidden: boolean): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    notOwner(u);
    u.hidden = hidden;
    await writeUsers(users);
  });
}

/** اللقب اللي بيظهر للأدمن الأساسي (الفحص في الطبقة اللي فوق). */
export async function setOwnerTitle(id: string, title: string): Promise<void> {
  await withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    if (!isOwner(u)) throw new Error("ده للأدمن الأساسي بس");
    u.display_title = title.trim().replace(/\s+/g, " ").slice(0, 40) || null;
    await writeUsers(users);
  });
}

/** صورة البروفايل (اسم الملف بس). بيرجع الاسم القديم عشان الطبقة اللي فوق تمسح ملفه. */
export async function setUserAvatar(id: string, avatar: string | null): Promise<string | null> {
  return withLock(async () => {
    const users = await readUsers();
    const u = mustFind(users, id);
    const old = u.avatar;
    u.avatar = avatar;
    await writeUsers(users);
    return old;
  });
}
