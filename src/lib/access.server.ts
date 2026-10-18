// الرتب + حساب الصلاحيات الفعلية لأي مستخدم + فحوصات الأمان (على السيرفر).
//
// الصلاحيات الفعلية = صلاحيات كل رتبه + الصلاحيات الفردية − الممنوعة.
// الرتب بتتقرا في كل طلب، فأي تعديل عليها بيتطبق فورًا على كل اللي معاهم الرتبة.
// صاحب الموقع (owner) مفيش فحص بيتطبق عليه.
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";
import * as auth from "./local-auth.server";
import { covers, hasAnyPerm, hasAnyPermAt, hasPerm, sanitizeKeys, type FieldGroup, type Scope } from "./permissions";

const RANKS_KEY = "bwd:ranks";

export type Rank = {
  id: string;
  name: string;
  permissions: string[];
  order: number; // الأقل = الأعلى أولوية (هي اللي بتظهر جنب اسم الشخص لو معاه أكتر من رتبة)
  created_at: string;
  updated_at: string;
};

const withLock = makeLock();

async function readRanks(): Promise<Rank[]> {
  const raw = await kvGetJSON<{ ranks?: Rank[] }>(RANKS_KEY, { ranks: [] });
  const list = (raw.ranks ?? []).map((r, i) => ({ ...r, order: typeof r.order === "number" ? r.order : i, permissions: sanitizeKeys(r.permissions) }));
  return list.sort((a, b) => a.order - b.order || a.created_at.localeCompare(b.created_at));
}
async function writeRanks(ranks: Rank[]) {
  await kvSetJSON(RANKS_KEY, { ranks });
}

/** الرتب مرتبة حسب الأولوية (الأعلى أولًا). */
export async function listRanks(): Promise<Rank[]> {
  return readRanks();
}

// ============================== Actor ==============================

export type Actor = {
  user: auth.User;
  owner: boolean;
  perms: Set<string>;
  ranks: Rank[];
  rankNames: string[];
};

export function effectivePerms(user: auth.User, ranks: Rank[]): Set<string> {
  const s = new Set<string>();
  for (const r of ranks) for (const k of r.permissions) s.add(k);
  for (const g of user.grants) s.add(g);
  for (const d of user.denies) s.delete(d);
  return s;
}

function ranksOfUser(user: auth.User, all: Rank[]): Rank[] {
  return user.rank_ids
    .map((id) => all.find((r) => r.id === id))
    .filter((r): r is Rank => !!r)
    .sort((a, b) => a.order - b.order); // الأعلى أولوية أولًا
}

/** المستخدم الحالي لو حسابه مفعّل. بيرجع null للموقوف/المعلّق/المحذوف. */
export async function actorFromUserId(uid: string | null): Promise<Actor | null> {
  if (!uid) return null;
  const user = await auth.getUserById(uid);
  if (!user || user.status !== "active") return null;
  const ranks = ranksOfUser(user, await readRanks());
  const owner = auth.isOwner(user);
  return { user, owner, ranks, rankNames: ranks.map((r) => r.name), perms: owner ? new Set() : effectivePerms(user, ranks) };
}

/** للـ API routes اللي بتستقبل Request خام: بنقرا كوكي الجلسة بنفسنا. */
export async function actorFromRequest(request: Request): Promise<Actor | null> {
  const header = request.headers.get("cookie") ?? "";
  const m = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  const token = m ? decodeURIComponent(m.slice(auth.SESSION_COOKIE.length + 1)) : null;
  return actorFromUserId(await auth.verifySessionToken(token));
}

export function can(actor: Actor, perm: string, scope?: Scope): boolean {
  return hasPerm(actor.perms, actor.owner, perm, scope);
}
/** أي صلاحية مرتبطة بالمفتاح ده (عامة أو على أي حاجة). */
export function canAny(actor: Actor, perm: string): boolean {
  return hasAnyPerm(actor.perms, actor.owner, perm);
}
/** أي صلاحية مرتبطة بالمفتاح ده على الـ scope ده بالذات. */
export function canAnyAt(actor: Actor, perm: string, scope: Scope): boolean {
  return hasAnyPermAt(actor.perms, actor.owner, perm, scope);
}
export function assertCan(actor: Actor, perm: string, scope?: Scope): void {
  if (!can(actor, perm, scope)) throw new Error("ليس لديك صلاحية لهذا الإجراء");
}
export function assertCanAny(actor: Actor, perms: string[]): void {
  if (!perms.some((p) => canAny(actor, p))) throw new Error("ليس لديك صلاحية لهذا الإجراء");
}
export function assertCanAnyAt(actor: Actor, perms: string[], scope: Scope): void {
  if (!perms.some((p) => canAnyAt(actor, p, scope))) throw new Error("ليس لديك صلاحية لهذا الإجراء");
}
/** كل حقل اتغيّر لازم يكون عنده صلاحيته (prefix.<id>) — وإلا بيرجع خطأ بأسماء الحقول الممنوعة. */
export function assertCanGroups(actor: Actor, prefix: string, groups: FieldGroup[], scope?: Scope): void {
  const denied = groups.filter((g) => !can(actor, `${prefix}.${g.id}`, scope));
  if (denied.length) throw new Error(`ليس لديك صلاحية تعديل: ${denied.map((g) => g.label).join("، ")}`);
}
export function actorCovers(actor: Actor, key: string): boolean {
  return covers(actor.perms, actor.owner, key);
}

// ============================== الرتب ==============================

const cleanName = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

/** مينفعش حد يدّي أو يعدّل حاجة أكبر من صلاحياته. */
function assertCoversAll(actor: Actor, keys: Iterable<string>, msg: string) {
  for (const k of keys) if (!actorCovers(actor, k)) throw new Error(msg);
}

export async function saveRank(actor: Actor, input: { id?: string; name: string; permissions: string[] }): Promise<Rank> {
  assertCan(actor, input.id ? "ranks.edit" : "ranks.create");
  const name = cleanName(input.name);
  if (!name) throw new Error("اسم الرتبة مطلوب");
  const permissions = sanitizeKeys(input.permissions);

  return withLock(async () => {
    const ranks = await readRanks();
    if (ranks.some((r) => r.id !== input.id && r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("في رتبة بنفس الاسم");
    }
    assertCoversAll(actor, permissions, "مينفعش تدّي رتبة صلاحيات أكبر من صلاحياتك");
    const now = new Date().toISOString();
    const idx = input.id ? ranks.findIndex((r) => r.id === input.id) : -1;
    if (idx >= 0) {
      assertCoversAll(actor, ranks[idx].permissions, "مينفعش تعدّل رتبة صلاحياتها أكبر من صلاحياتك");
      ranks[idx] = { ...ranks[idx], name, permissions, updated_at: now };
      await writeRanks(ranks);
      return ranks[idx];
    }
    const created: Rank = { id: crypto.randomUUID(), name, permissions, order: Math.max(-1, ...ranks.map((r) => r.order)) + 1, created_at: now, updated_at: now };
    ranks.push(created);
    await writeRanks(ranks);
    return created;
  });
}

export async function deleteRank(actor: Actor, id: string): Promise<{ affected: number; name: string }> {
  assertCan(actor, "ranks.delete");
  const name = await withLock(async () => {
    const ranks = await readRanks();
    const r = ranks.find((x) => x.id === id);
    if (!r) throw new Error("الرتبة غير موجودة");
    assertCoversAll(actor, r.permissions, "مينفعش تمسح رتبة صلاحياتها أكبر من صلاحياتك");
    await writeRanks(ranks.filter((x) => x.id !== id));
    return r.name;
  });
  const affected = await auth.clearRankFromUsers(id);
  return { affected, name };
}

// ============================== التعامل مع الأعضاء ==============================

async function targetEffective(target: auth.User): Promise<Set<string>> {
  return effectivePerms(target, ranksOfUser(target, await readRanks()));
}

/** هل الـ actor يقدر يتعامل مع الشخص ده؟ لازم يغطي كل صلاحياته ومايكونش هو نفسه ولا الأدمن الأساسي. المخفيين كأنهم مش موجودين. */
export async function assertCanActOn(actor: Actor, targetId: string, opts: { allowSelf?: boolean } = {}): Promise<auth.User> {
  const target = await auth.getUserById(targetId);
  if (!target || (target.hidden && !actor.owner)) throw new Error("الحساب غير موجود");
  if (auth.isOwner(target)) throw new Error("مينفعش التعديل على الأدمن الأساسي");
  if (!opts.allowSelf && target.id === actor.user.id) throw new Error("مينفعش تعمل ده على حسابك أنت");
  if (!actor.owner && target.status === "active") {
    assertCoversAll(actor, await targetEffective(target), "الشخص ده صلاحياته أكبر من صلاحياتك");
  }
  return target;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export async function assignStaff(
  actor: Actor,
  targetId: string,
  next: { rank_ids: string[]; grants: string[]; denies: string[] },
): Promise<{ changed: boolean; before: { ranks: string[]; grants: string[]; denies: string[] }; after: { ranks: string[]; grants: string[]; denies: string[] } }> {
  assertCanAny(actor, ["staff"]);
  const target = await assertCanActOn(actor, targetId);
  if (target.status !== "active") throw new Error("الحساب لازم يكون مفعّل");

  const all = await readRanks();
  const rank_ids = [...new Set(next.rank_ids)];
  const nextRanks = rank_ids.map((id) => all.find((r) => r.id === id));
  if (nextRanks.some((r) => !r)) throw new Error("رتبة غير موجودة");
  const grants = sanitizeKeys(next.grants);
  const denies = sanitizeKeys(next.denies);

  const rankChanged = !sameSet(rank_ids, target.rank_ids);
  const grantChanged = !sameSet(grants, target.grants) || !sameSet(denies, target.denies);
  const nameOf = (ids: string[]) => ids.map((id) => all.find((r) => r.id === id)?.name ?? "(رتبة محذوفة)");
  const before = { ranks: nameOf(target.rank_ids), grants: target.grants, denies: target.denies };
  const after = { ranks: nameOf(rank_ids), grants, denies };
  if (!rankChanged && !grantChanged) return { changed: false, before, after };
  if (rankChanged) assertCan(actor, "staff.rank");
  if (grantChanged) assertCan(actor, "staff.grant");

  // الصلاحيات الفعلية بعد التعديل لازم تكون كلها ضمن صلاحيات اللي بيعدّل
  const eff = effectivePerms({ ...target, grants, denies }, nextRanks as Rank[]);
  assertCoversAll(actor, eff, "مينفعش تدّي صلاحيات أكبر من صلاحياتك");

  await auth.updateUserAssignments(targetId, { rank_ids, grants, denies });
  return { changed: true, before, after };
}

export async function rankNamesOf(user: auth.User): Promise<string[]> {
  return ranksOfUser(user, await readRanks()).map((r) => r.name);
}

/** ترتيب الرتب: اللي بتتبعت بتتحط فوق بالترتيب ده، والباقي بعدها. بيحدد الرتبة اللي بتظهر جنب اسم الشخص. */
export async function reorderRanks(actor: Actor, ids: string[]): Promise<{ before: string[]; after: string[] }> {
  assertCan(actor, "ranks.reorder");
  return withLock(async () => {
    const ranks = await readRanks();
    const before = ranks.map((r) => r.name);
    const first = [...new Set(ids)].map((id) => ranks.find((r) => r.id === id)).filter((r): r is Rank => !!r);
    const rest = ranks.filter((r) => !first.includes(r));
    const next = [...first, ...rest].map((r, i) => ({ ...r, order: i }));
    await writeRanks(next);
    return { before, after: next.map((r) => r.name) };
  });
}
