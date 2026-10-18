// سجل النشاط: (1) كل اللي بتعمله الإدارة في الموقع (2) تسجيلات الدخول. للأدمن الأساسي بس.
// التخزين عن طريق kv-store (ملفات data/ دلوقتي، وSupabase بعدين).
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";
import type { FieldGroup } from "./permissions";

const ADMIN_KEY = "bwd:audit-log";
const LOGIN_KEY = "bwd:login-log";
const MAX_ADMIN = 5000;
const MAX_LOGIN = 3000;

export type AuditCategory =
  | "sections" | "items" | "topics" | "uploads" | "exams" | "questions" | "attempts"
  | "accounts" | "ranks" | "staff" | "settings" | "chats" | "announcements";

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  sections: "الأقسام", items: "العناصر", topics: "المواضيع", uploads: "رفع ملفات", exams: "الاختبارات",
  questions: "الأسئلة", attempts: "التسليمات والمحظورين", accounts: "الحسابات", ranks: "الرتب",
  staff: "الصلاحيات", settings: "إعدادات الأدمن", chats: "الدردشات", announcements: "الإعلانات",
};

export type AuditChange = { label: string; before: string | null; after: string | null };

export type AuditEntry = {
  id: string;
  at: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  actor_rank: string | null;
  category: AuditCategory;
  action: string; // مفتاح قصير مثل item.update
  summary: string; // ملخص بسطر واحد
  target: string | null; // اسم الحاجة اللي اتعمل عليها
  changes: AuditChange[]; // قبل / بعد
  note: string | null; // تفاصيل إضافية
};

export type LoginEntry = {
  id: string;
  at: string;
  identifier: string;
  method: "email" | "account_name";
  user_id: string | null;
  account_name: string | null;
  ok: boolean;
  reason: string;
  ip: string | null;
  user_agent: string | null;
};

/** الشكل الأدنى اللي محتاجينه من الـ actor (عشان ما نعملش import دائري). */
export type AuditActor = {
  user: { id: string; email: string; account_name: string; display_title: string | null };
  owner: boolean;
  rankNames: string[];
};

const withLock = makeLock();

// ============================== تنسيق القيم ==============================

const SECRET_FIELDS = new Set(["password"]);

function clip(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function fmtValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return clip(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return clip(v.join("، ")) || null;
    return `${v.length} عنصر`;
  }
  return clip(JSON.stringify(v));
}

/** بيحوّل الحقول اللي اتغيرت لقايمة قبل/بعد. كلمات السر بتتخفى. */
export function buildChanges(groups: FieldGroup[], existing: Record<string, unknown>, incoming: Record<string, unknown>): AuditChange[] {
  const out: AuditChange[] = [];
  for (const g of groups) {
    for (const f of g.fields) {
      if (!(f in incoming)) continue;
      const before = existing[f] ?? null;
      const after = incoming[f] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const label = g.fields.length > 1 ? `${g.label} — ${f}` : g.label;
      if (SECRET_FIELDS.has(f)) out.push({ label, before: before ? "••••" : null, after: after ? "••••" : null });
      else out.push({ label, before: fmtValue(before), after: fmtValue(after) });
    }
  }
  return out;
}

// ============================== سجل الإدارة ==============================

function actorName(a: AuditActor): string {
  if (a.owner) return a.user.display_title || "الأدمن الأساسي";
  return a.user.account_name || a.user.email;
}

export async function logAdmin(
  actor: AuditActor,
  e: { category: AuditCategory; action: string; summary: string; target?: string | null; changes?: AuditChange[]; note?: string | null },
): Promise<void> {
  try {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor_id: actor.user.id,
      actor_name: actorName(actor),
      actor_email: actor.user.email,
      actor_rank: actor.owner ? (actor.user.display_title ? null : "صاحب الموقع") : actor.rankNames.join("، ") || null,
      category: e.category,
      action: e.action,
      summary: clip(e.summary, 200),
      target: e.target ? clip(e.target, 120) : null,
      changes: e.changes ?? [],
      note: e.note ? clip(e.note, 600) : null,
    };
    await withLock(async () => {
      const log = await kvGetJSON<{ entries?: AuditEntry[] }>(ADMIN_KEY, { entries: [] });
      const entries = [...(log.entries ?? []), entry];
      await kvSetJSON(ADMIN_KEY, { entries: entries.slice(-MAX_ADMIN) });
    });
  } catch {
    /* السجل ميوقفش العملية الأساسية */
  }
}

export async function listAdminAudit(opts: { offset?: number; limit?: number; category?: string; search?: string }): Promise<{ entries: AuditEntry[]; total: number }> {
  const log = await kvGetJSON<{ entries?: AuditEntry[] }>(ADMIN_KEY, { entries: [] });
  const q = (opts.search ?? "").trim().toLowerCase();
  let list = [...(log.entries ?? [])].reverse();
  if (opts.category) list = list.filter((e) => e.category === opts.category);
  if (q) {
    list = list.filter((e) =>
      [e.actor_name, e.actor_email, e.actor_rank ?? "", e.summary, e.target ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  return { entries: list.slice(offset, offset + limit), total: list.length };
}

// ============================== سجل الدخول ==============================

export async function logLogin(e: Omit<LoginEntry, "id" | "at">): Promise<void> {
  try {
    const entry: LoginEntry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      ...e,
      identifier: clip(e.identifier, 80),
      user_agent: e.user_agent ? clip(e.user_agent, 200) : null,
    };
    await withLock(async () => {
      const log = await kvGetJSON<{ entries?: LoginEntry[] }>(LOGIN_KEY, { entries: [] });
      const entries = [...(log.entries ?? []), entry];
      await kvSetJSON(LOGIN_KEY, { entries: entries.slice(-MAX_LOGIN) });
    });
  } catch {
    /* ignore */
  }
}

export async function listLogins(opts: { offset?: number; limit?: number; status?: string; search?: string }): Promise<{ entries: LoginEntry[]; total: number }> {
  const log = await kvGetJSON<{ entries?: LoginEntry[] }>(LOGIN_KEY, { entries: [] });
  const q = (opts.search ?? "").trim().toLowerCase();
  let list = [...(log.entries ?? [])].reverse();
  if (opts.status === "ok") list = list.filter((e) => e.ok);
  if (opts.status === "failed") list = list.filter((e) => !e.ok);
  if (q) list = list.filter((e) => [e.identifier, e.account_name ?? "", e.ip ?? ""].some((v) => v.toLowerCase().includes(q)));
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  return { entries: list.slice(offset, offset + limit), total: list.length };
}
