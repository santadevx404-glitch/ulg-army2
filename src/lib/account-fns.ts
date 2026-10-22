// Server functions الخاصة بالحسابات والرتب والصلاحيات والسجل.
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import * as access from "./access.server";
import * as audit from "./audit.server";
import * as store from "./local-store.server";
import * as exams from "./exams.server";
import * as chats from "./chat.server";
import * as announcements from "./announcements.server";
import { SCOPE_TREES, labelOfBase, parseKey } from "./permissions";

async function requireActor(): Promise<access.Actor> {
  const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
  if (!actor) throw new Error("غير مسجل الدخول");
  return actor;
}
function ownerOnly(actor: access.Actor) {
  if (!actor.owner) throw new Error("ده للأدمن الأساسي بس");
}
function fullOnly(actor: access.Actor) {
  if (!actor.full) throw new Error("ده لأصحاب الصلاحيات الكاملة بس");
}

/** أسماء الأقسام/العناصر/الاختبارات عشان نكتب الصلاحيات المخصصة بشكل مقروء في السجل. */
async function permTexts(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const [sections, items, examList, chatList, annList] = await Promise.all([store.getSections(), store.getItems(), exams.adminListExams(), chats.listChats(), announcements.listAnnouncements()]);
  return keys.map((k) => {
    const { base, type, id } = parseKey(k);
    const label = labelOfBase(base);
    if (!type) return `${label} (عام)`;
    const name =
      type === "section" ? sections.find((s) => s.id === id)?.name
      : type === "item" ? items.find((i) => i.id === id)?.title
      : type === "chat" ? chatList.find((c) => c.id === id)?.name
      : type === "announcement" ? annList.find((a) => a.id === id)?.title
      : examList.find((e) => e.id === id)?.title;
    return `${label} — ${SCOPE_TREES[type].title} «${name ?? "محذوف"}»`;
  });
}

async function diffPerms(before: string[], after: string[]): Promise<string> {
  const added = after.filter((k) => !before.includes(k));
  const removed = before.filter((k) => !after.includes(k));
  const parts: string[] = [];
  if (added.length) parts.push(`إضافة:\n${(await permTexts(added)).slice(0, 25).map((t) => `+ ${t}`).join("\n")}${added.length > 25 ? `\n… و${added.length - 25} كمان` : ""}`);
  if (removed.length) parts.push(`سحب:\n${(await permTexts(removed)).slice(0, 25).map((t) => `− ${t}`).join("\n")}${removed.length > 25 ? `\n… و${removed.length - 25} كمان` : ""}`);
  return parts.join("\n\n");
}

// ==================== عام (من غير تسجيل دخول) ====================

export const requestAccountFn = createServerFn({ method: "POST" })
  .validator((d: auth.AccountRequestInput) => d)
  .handler(async ({ data }) => auth.requestAccount(data));

/** أسماء الرتب بس (للاقتراحات في صفحة الطلب). */
export const publicRankNamesFn = createServerFn({ method: "GET" }).handler(async () => {
  return (await access.listRanks()).map((r) => r.name);
});

// ==================== حسابي ====================

export const changeMyPasswordFn = createServerFn({ method: "POST" })
  .validator((d: { oldPassword: string; newPassword: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    return auth.changeOwnPassword(actor.user.id, data.oldPassword, data.newPassword);
  });

/** اللقب اللي بيظهر للأدمن الأساسي. */
export const setMyTitleFn = createServerFn({ method: "POST" })
  .validator((title: string) => title)
  .handler(async ({ data: title }) => {
    const actor = await requireActor();
    ownerOnly(actor);
    const before = actor.user.display_title;
    await auth.setOwnerTitle(actor.user.id, title);
    await audit.logAdmin(actor, {
      category: "settings", action: "owner.title", summary: "غيّر اللقب اللي بيظهر للأدمن الأساسي",
      changes: [{ label: "اللقب", before: before || "الأدمن الأساسي", after: title.trim() || "الأدمن الأساسي" }],
    });
    return {};
  });

// ==================== طلبات الحسابات ====================

export type RequestRow = {
  id: string;
  email: string;
  account_name: string;
  character_name: string;
  military_code: string;
  rank_requested: string;
  created_at: string;
  status: "pending" | "rejected";
  reject_reason: string | null;
};

/** عدّاد الطلبات الجديدة (بيرجع 0 لو مفيش صلاحية بدل ما يرمي خطأ). */
export const pendingRequestsCountFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
  if (!actor || !access.canAny(actor, "accounts.requests")) return 0;
  return auth.countPendingRequests();
});

export const requestsListFn = createServerFn({ method: "GET" }).handler(async (): Promise<RequestRow[]> => {
  const actor = await requireActor();
  access.assertCan(actor, "accounts.requests.view");
  const users = await auth.listUsers();
  return users
    .filter((u) => u.status === "pending" || u.status === "rejected")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((u) => ({
      id: u.id,
      email: u.email,
      account_name: u.account_name,
      character_name: u.character_name,
      military_code: u.military_code,
      rank_requested: u.rank_requested,
      created_at: u.created_at,
      status: u.status as "pending" | "rejected",
      reject_reason: u.reject_reason,
    }));
});

export const approveRequestFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; rankIds: string[] }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.requests.approve");
    const target = await auth.getUserById(data.id);
    if (!target || target.status !== "pending") throw new Error("الطلب ده اتراجع قبل كده");
    const rankIds = [...new Set(data.rankIds ?? [])];
    let names: string[] = [];
    if (rankIds.length) {
      // إعطاء رتب عند القبول = تعيين صلاحيات، فلازم staff.rank وتغطية صلاحيات الرتب
      access.assertCan(actor, "staff.rank");
      const all = await access.listRanks();
      for (const id of rankIds) {
        const rank = all.find((r) => r.id === id);
        if (!rank) throw new Error("الرتبة غير موجودة");
        for (const k of rank.permissions) {
          if (!access.actorCovers(actor, k)) throw new Error("مينفعش تدّي رتبة صلاحياتها أكبر من صلاحياتك");
        }
        names.push(rank.name);
      }
    }
    await auth.approveRequest(data.id, rankIds, actor.user.id);
    await audit.logAdmin(actor, {
      category: "accounts", action: "request.approve", summary: `قبل طلب حساب «${target.account_name}»`, target: target.account_name,
      note: names.length ? `الرتب: ${names.join("، ")}` : "من غير رتبة",
    });
    return {};
  });

export const rejectRequestFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; reason: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.requests.reject");
    const target = await auth.getUserById(data.id);
    await auth.rejectRequest(data.id, data.reason ?? "", actor.user.id);
    await audit.logAdmin(actor, {
      category: "accounts", action: "request.reject", summary: `رفض طلب حساب «${target?.account_name ?? ""}»`, target: target?.account_name ?? null,
      note: data.reason?.trim() ? `السبب: ${data.reason.trim()}` : null,
    });
    return {};
  });

// ==================== الأعضاء ====================

export type MemberRow = {
  id: string;
  email: string;
  account_name: string;
  character_name: string;
  military_code: string;
  rank_requested: string;
  rank_ids: string[];
  rank_names: string[];
  display_title: string | null;
  avatar: string | null;
  status: "active" | "disabled";
  grants: string[];
  denies: string[];
  hidden: boolean;
  is_owner: boolean;
  is_me: boolean;
  /** هل المستخدم الحالي يقدر يتعامل مع الشخص ده (صلاحياته أقل من أو تساوي صلاحياتك) */
  manageable: boolean;
  created_at: string;
};

export const membersListFn = createServerFn({ method: "GET" }).handler(async (): Promise<MemberRow[]> => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["accounts.members", "staff"]);
  const [users, ranks] = await Promise.all([auth.listUsers(), access.listRanks()]);
  return users
    .filter((u) => (u.status === "active" || u.status === "disabled") && (actor.full || !u.hidden)) // المخفيين للأدمن الأساسي بس
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((u) => {
      const userRanks = u.rank_ids.map((id) => ranks.find((r) => r.id === id)).filter((r): r is access.Rank => !!r).sort((a, b) => a.order - b.order);
      const owner = auth.isOwner(u);
      const eff = access.effectivePerms(u, userRanks);
      const manageable = !owner && u.id !== actor.user.id && (actor.full || [...eff].every((k) => access.actorCovers(actor, k)));
      return {
        id: u.id,
        email: u.email,
        account_name: u.account_name,
        character_name: u.character_name,
        military_code: u.military_code,
        rank_requested: u.rank_requested,
        rank_ids: userRanks.map((r) => r.id),
        rank_names: userRanks.map((r) => r.name),
        display_title: owner ? u.display_title : null,
        avatar: u.avatar,
        status: u.status as "active" | "disabled",
        grants: u.grants,
        denies: u.denies,
        hidden: u.hidden,
        is_owner: owner,
        is_me: u.id === actor.user.id,
        manageable,
        created_at: u.created_at,
      };
    });
});

export const setMemberStatusFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; status: "active" | "disabled" }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.members.disable");
    const target = await access.assertCanActOn(actor, data.id);
    const status = data.status === "disabled" ? "disabled" : "active";
    await auth.setUserStatus(data.id, status);
    await audit.logAdmin(actor, {
      category: "accounts", action: status === "disabled" ? "member.disable" : "member.enable",
      summary: `${status === "disabled" ? "أوقف" : "فعّل"} حساب «${target.account_name}»`, target: target.account_name,
    });
    return {};
  });

export const resetMemberPasswordFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; password: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.members.password");
    const target = await access.assertCanActOn(actor, data.id);
    await auth.resetUserPassword(data.id, data.password);
    await audit.logAdmin(actor, { category: "accounts", action: "member.password", summary: `غيّر كلمة سر «${target.account_name}»`, target: target.account_name });
    return {};
  });

export const deleteMemberFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.members.delete");
    const target = await access.assertCanActOn(actor, id);
    await auth.deleteUser(id);
    await audit.logAdmin(actor, {
      category: "accounts", action: "member.delete", summary: `حذف حساب «${target.account_name}»`, target: target.account_name,
      note: `${target.character_name} — ${target.military_code}`,
    });
    return {};
  });

export const updateMemberDetailsFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; account_name: string; character_name: string; military_code: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "accounts.members.edit");
    const target = await access.assertCanActOn(actor, data.id);
    await auth.updateUserDetails(data.id, data);
    const pairs: [string, string, string][] = [
      ["اسم الحساب", target.account_name, data.account_name],
      ["اسم الشخصية", target.character_name, data.character_name],
      ["الكود العسكري", target.military_code, data.military_code],
    ];
    await audit.logAdmin(actor, {
      category: "accounts", action: "member.update", summary: `عدّل بيانات «${target.account_name}»`, target: target.account_name,
      changes: pairs.filter(([, b, a]) => b !== a.trim()).map(([label, before, after]) => ({ label, before: before || null, after: after.trim() || null })),
    });
    return {};
  });

export const assignMemberFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; rank_ids: string[]; grants: string[]; denies: string[] }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const res = await access.assignStaff(actor, data.id, { rank_ids: data.rank_ids ?? [], grants: data.grants ?? [], denies: data.denies ?? [] });
    if (res.changed) {
      const target = await auth.getUserById(data.id);
      const notes: string[] = [];
      const gd = await diffPerms(res.before.grants, res.after.grants);
      if (gd) notes.push(`صلاحيات فردية —\n${gd}`);
      const dd = await diffPerms(res.before.denies, res.after.denies);
      if (dd) notes.push(`صلاحيات ممنوعة —\n${dd}`);
      await audit.logAdmin(actor, {
        category: "staff", action: "member.assign", summary: `عدّل رتب وصلاحيات «${target?.account_name ?? ""}»`, target: target?.account_name ?? null,
        changes: res.before.ranks.join("،") !== res.after.ranks.join("،")
          ? [{ label: "الرتب", before: res.before.ranks.join("، ") || "من غير رتبة", after: res.after.ranks.join("، ") || "من غير رتبة" }]
          : [],
        note: notes.join("\n\n") || null,
      });
    }
    return {};
  });

/** إخفاء/إظهار عضو من قايمة الأعضاء — الأدمن الأساسي بس. */
export const setMemberHiddenFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; hidden: boolean }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    fullOnly(actor);
    const target = await auth.getUserById(data.id);
    if (!target) throw new Error("الحساب غير موجود");
    await auth.setUserHidden(data.id, !!data.hidden);
    await audit.logAdmin(actor, {
      category: "accounts", action: data.hidden ? "member.hide" : "member.unhide",
      summary: `${data.hidden ? "أخفى" : "أظهر"} «${target.account_name}» ${data.hidden ? "من" : "في"} قايمة الأعضاء`, target: target.account_name,
    });
    return {};
  });

// ==================== الرتب ====================

export type RankRow = access.Rank & { members: number };

export const ranksListFn = createServerFn({ method: "GET" }).handler(async (): Promise<RankRow[]> => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["ranks", "staff", "accounts.requests", "accounts.members"]);
  const [ranks, users] = await Promise.all([access.listRanks(), auth.listUsers()]);
  // المخفيين مبيتحسبوش لغير الأدمن الأساسي
  const counted = users.filter((u) => u.status !== "rejected" && (actor.full || !u.hidden));
  return ranks.map((r) => ({ ...r, members: counted.filter((u) => u.rank_ids.includes(r.id)).length }));
});

export const saveRankFn = createServerFn({ method: "POST" })
  .validator((d: { id?: string; name: string; permissions: string[] }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const before = data.id ? (await access.listRanks()).find((r) => r.id === data.id) : undefined;
    const saved = await access.saveRank(actor, data);
    const diff = await diffPerms(before?.permissions ?? [], saved.permissions);
    await audit.logAdmin(actor, {
      category: "ranks", action: before ? "rank.update" : "rank.create",
      summary: `${before ? "عدّل" : "أنشأ"} الرتبة «${saved.name}»`, target: saved.name,
      changes: before && before.name !== saved.name ? [{ label: "الاسم", before: before.name, after: saved.name }] : [],
      note: diff || (before ? null : "من غير صلاحيات"),
    });
    return saved;
  });

export const deleteRankFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const res = await access.deleteRank(actor, id);
    await chats.removeRankFromChats(id);
    await announcements.removeRankFromAnnouncements(id);
    await audit.logAdmin(actor, {
      category: "ranks", action: "rank.delete", summary: `حذف الرتبة «${res.name}»`, target: res.name,
      note: res.affected ? `${res.affected} عضو فقدوها` : null,
    });
    return { affected: res.affected };
  });

export const reorderRanksFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    const res = await access.reorderRanks(actor, ids);
    await audit.logAdmin(actor, {
      category: "ranks", action: "rank.reorder", summary: "غيّر ترتيب الرتب",
      note: `الترتيب الجديد (الأعلى أولًا):\n${res.after.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
      changes: [{ label: "الترتيب", before: res.before.join(" ← "), after: res.after.join(" ← ") }],
    });
    return {};
  });

/** أسماء الأقسام والعناصر والاختبارات (لمحرر الصلاحيات). */
export const permCatalogFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["ranks", "staff"]);
  const [sections, items, examList, chatList, annList] = await Promise.all([store.getSections(), store.getItems(), exams.adminListExams(), chats.listChats(), announcements.listAnnouncements()]);
  return {
    announcements: annList.map((a) => ({ id: a.id, title: a.title })),
    chats: chatList.map((c) => ({ id: c.id, name: c.name })),
    sections: sections.map((s) => ({ id: s.id, name: s.name })),
    items: items.map((i) => ({ id: i.id, title: i.title, section_id: i.section_id })),
    exams: examList.map((e) => ({ id: e.id, title: e.title })),
  };
});

// ==================== السجل (الأدمن الأساسي بس) ====================

export const auditListFn = createServerFn({ method: "POST" })
  .validator((d: { offset?: number; limit?: number; category?: string; search?: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    fullOnly(actor);
    return audit.listAdminAudit(data);
  });

export const loginLogFn = createServerFn({ method: "POST" })
  .validator((d: { offset?: number; limit?: number; status?: string; search?: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    fullOnly(actor);
    return audit.listLogins(data);
  });
