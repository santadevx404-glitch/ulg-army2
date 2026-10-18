// Server functions الإعلانات: العرض للزوار + الإدارة من لوحة التحكم.
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import * as access from "./access.server";
import * as audit from "./audit.server";
import * as store from "./local-store.server";
import * as ann from "./announcements.server";
import { ANNOUNCEMENT_FIELDS, changedGroups, wildcardKey } from "./permissions";

async function requireActor(): Promise<access.Actor> {
  const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
  if (!actor) throw new Error("غير مسجل الدخول");
  return actor;
}

/** أماكن الصفحة دي: "all" + المكان المحدد (الرئيسية / الاختبارات / الدردشات / قسم / عنصر). */
async function tokensForPath(rawPath: string): Promise<string[]> {
  const p = (String(rawPath || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/").slice(0, 300);
  if (p === "/admin" || p.startsWith("/admin/")) return []; // مبنعرضش إعلانات جوه لوحة التحكم
  if (/^\/exams\/[^/]+/.test(p)) return []; // ولا أثناء الاختبار نفسه
  const t = ["all"];
  if (p === "/") t.push("home");
  else if (p === "/exams") t.push("exams");
  else if (p === "/chat" || p.startsWith("/chat/")) t.push("chat");
  else {
    const m = p.match(/^\/s\/([^/]+)(?:\/([^/]+))?/);
    if (m) {
      const section = (await store.getSections()).find((s) => s.slug === decodeURIComponent(m[1]));
      if (section) t.push(`section:${section.id}`);
      if (m[2]) t.push(`item:${decodeURIComponent(m[2])}`);
    }
  }
  return t;
}

// ==================== العرض (الزوار) ====================

export const activeAnnouncementsFn = createServerFn({ method: "POST" })
  .validator((d: { path: string }) => d)
  .handler(async ({ data }): Promise<ann.PublicAnnouncement[]> => {
    const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
    const viewer: ann.Viewer = { loggedIn: !!actor, owner: !!actor?.owner, rank_ids: actor?.user.rank_ids ?? [] };
    return ann.activeFor(await tokensForPath(data.path), viewer);
  });

// ==================== لوحة التحكم ====================

export type AnnouncementAdminRow = ann.Announcement & {
  can: { settings: Record<string, boolean>; anySettings: boolean; delete: boolean };
};

function annCan(actor: access.Actor, id: string): AnnouncementAdminRow["can"] {
  const scope = { announcement: id };
  const settings: Record<string, boolean> = {};
  for (const g of ANNOUNCEMENT_FIELDS) settings[g.id] = access.can(actor, `announcements.edit.${g.id}`, scope);
  return { settings, anySettings: Object.values(settings).some(Boolean), delete: access.can(actor, "announcements.delete", scope) };
}

export const announcementsAdminFn = createServerFn({ method: "GET" }).handler(async (): Promise<AnnouncementAdminRow[]> => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["announcements"]);
  return (await ann.listAnnouncements())
    .filter((a) => actor.owner || access.canAnyAt(actor, "announcements", { announcement: a.id }))
    .map((a) => ({ ...a, can: annCan(actor, a.id) }));
});

/** اختيارات المحرر: الأقسام والعناصر والرتب. */
export const announcementOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["announcements"]);
  const [sections, items, ranks] = await Promise.all([store.getSections(), store.getItems(), access.listRanks()]);
  return {
    sections: sections.map((s) => ({ id: s.id, name: s.name })),
    items: items.map((i) => ({ id: i.id, title: i.title, section_id: i.section_id })),
    ranks: ranks.map((r) => ({ id: r.id, name: r.name })),
  };
});

const AUDIENCE_LABEL: Record<string, string> = { everyone: "الكل", members: "المسجّلين بس", ranks: "رتب معينة" };

async function targetLabels(targets: string[]): Promise<string> {
  const [sections, items] = await Promise.all([store.getSections(), store.getItems()]);
  return targets.map((t) => {
    if (t === "all") return "كل الصفحات";
    if (t === "home") return "الرئيسية";
    if (t === "exams") return "الاختبارات";
    if (t === "chat") return "الدردشات";
    if (t.startsWith("section:")) return `قسم «${sections.find((s) => s.id === t.slice(8))?.name ?? "محذوف"}»`;
    if (t.startsWith("item:")) return `عنصر «${items.find((i) => i.id === t.slice(5))?.title ?? "محذوف"}»`;
    return t;
  }).join("، ");
}

export const saveAnnouncementFn = createServerFn({ method: "POST" })
  .validator((d: ann.AnnouncementInput) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const ranks = await access.listRanks();
    const validRanks = new Set(ranks.map((r) => r.id));
    const rankNames = (ids: string[]) => ids.map((id) => ranks.find((r) => r.id === id)?.name ?? "(محذوفة)").join("، ") || null;

    if (data.id) {
      const existing = await ann.getAnnouncement(data.id);
      if (!existing) throw new Error("الإعلان غير موجود");
      const groups = changedGroups(ANNOUNCEMENT_FIELDS, existing as unknown as Record<string, unknown>, data as Record<string, unknown>);
      if (groups.length === 0) return existing;
      access.assertCanGroups(actor, "announcements.edit", groups, { announcement: existing.id });
      // بنعدّل الحقول اللي اتغيّرت وبس
      const patch: Record<string, unknown> = { id: existing.id };
      for (const g of groups) for (const f of g.fields) if (f in data) patch[f] = (data as Record<string, unknown>)[f];
      const saved = await ann.saveAnnouncement(patch as ann.AnnouncementInput, validRanks);
      const changes = audit.buildChanges(groups, existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>);
      for (const c of changes) {
        if (c.label === ANNOUNCEMENT_FIELDS.find((g) => g.id === "targets")!.label) {
          c.before = await targetLabels(existing.targets); c.after = await targetLabels(saved.targets);
        }
        if (c.label.includes("rank_ids")) { c.before = rankNames(existing.rank_ids); c.after = rankNames(saved.rank_ids); }
        if (c.label.includes("audience")) { c.before = AUDIENCE_LABEL[existing.audience]; c.after = AUDIENCE_LABEL[saved.audience]; }
        if (c.label.endsWith("— image") || c.label === "صورة الإعلان") { c.before = existing.image ? "صورة" : null; c.after = saved.image ? "صورة" : null; }
      }
      await audit.logAdmin(actor, { category: "announcements", action: "announcement.update", summary: `عدّل الإعلان «${existing.title}»`, target: existing.title, changes });
      return saved;
    }
    access.assertCan(actor, "announcements.create");
    const created = await ann.saveAnnouncement({ ...data, id: undefined }, validRanks);
    if (!actor.owner) await auth.addGrants(actor.user.id, [wildcardKey("announcement", created.id)]); // اللي عمل الإعلان يديره
    await audit.logAdmin(actor, {
      category: "announcements", action: "announcement.create", summary: `أنشأ إعلان «${created.title}»`, target: created.title,
      note: `الأماكن: ${await targetLabels(created.targets)}\nالجمهور: ${AUDIENCE_LABEL[created.audience]}${created.audience === "ranks" ? ` (${rankNames(created.rank_ids)})` : ""}`,
    });
    return created;
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const existing = await ann.getAnnouncement(id);
    if (!existing) return {};
    access.assertCan(actor, "announcements.delete", { announcement: id });
    await ann.deleteAnnouncement(id);
    await audit.logAdmin(actor, { category: "announcements", action: "announcement.delete", summary: `حذف الإعلان «${existing.title}»`, target: existing.title });
    return {};
  });
