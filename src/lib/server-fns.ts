import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie, getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import * as auth from "./local-auth.server";
import * as store from "./local-store.server";
import * as access from "./access.server";
import * as audit from "./audit.server";
import { ITEM_FIELDS, SECTION_FIELDS, TOPIC_FIELDS, changedGroups, visibleTabs, wildcardKey } from "./permissions";
import fs from "node:fs";
import path from "node:path";
import { USE_LOCAL_STORAGE } from "./kv-store.server";

async function currentUserId(): Promise<string | null> {
  const token = getCookie(auth.SESSION_COOKIE);
  return auth.verifySessionToken(token);
}

/** المستخدم الحالي (حسابه لازم يكون مفعّل). الصلاحيات بتتفحص بعدها بـ access.assertCan. */
async function requireActor(): Promise<access.Actor> {
  const actor = await access.actorFromUserId(await currentUserId());
  if (!actor) throw new Error("غير مسجل الدخول");
  return actor;
}

const MASK = "••••";

/** كلمة السر المقنّعة اللي رجعت للعميل مش تعديل — بنشيلها عشان متتحسبش تغيير. */
function unmask<T extends { password?: string | null }>(d: T): T {
  if (d.password === MASK) {
    const { password: _p, ...rest } = d;
    return rest as T;
  }
  return d;
}

// ==================== Auth ====================

export const signupFn = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    return auth.signup(data.email, data.password);
  });

export const loginFn = createServerFn({ method: "POST" })
  // identifier = الإيميل أو اسم الحساب (email محتفظين بيه للتوافق)
  .validator((d: { identifier?: string; email?: string; password: string }) => d)
  .handler(async ({ data }) => {
    const identifier = String(data.identifier ?? data.email ?? "");
    const res = await auth.verifyLogin(identifier, data.password);
    let ip: string | null = null;
    let ua: string | null = null;
    try { ip = getRequestIP({ xForwardedFor: true }) ?? null; ua = getRequestHeader("user-agent") ?? null; } catch { /* ignore */ }
    const who = res.ok ? res.user : res.user;
    await audit.logLogin({
      identifier,
      method: res.method,
      user_id: who?.id ?? null,
      account_name: who?.account_name || null,
      ok: res.ok,
      reason: res.ok ? "ok" : res.reason,
      ip,
      user_agent: ua,
    });
    if (!res.ok) return { error: res.error };
    const token = await auth.createSessionToken(res.user.id);
    setCookie(auth.SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: auth.SESSION_MAX_AGE,
    });
    return { email: res.user.email };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(auth.SESSION_COOKIE, { path: "/" });
  return {};
});

export const currentUserFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await access.actorFromUserId(await currentUserId());
  if (!actor) return null;
  const { user } = actor;
  const perms = [...actor.perms];
  const tabs = visibleTabs(actor.perms, actor.owner);
  const title = actor.owner ? user.display_title || "الأدمن الأساسي" : null;
  return {
    id: user.id,
    email: user.email,
    owner: actor.owner,
    perms,
    tabs,
    // role محتفظين بيه للتوافق: "admin" = عنده أي حاجة في لوحة التحكم
    role: tabs.length > 0 ? ("admin" as const) : ("member" as const),
    account_name: user.account_name,
    character_name: user.character_name,
    military_code: user.military_code,
    rank_requested: user.rank_requested,
    rank_names: actor.rankNames,
    rank_name: title ?? (actor.rankNames.join("، ") || null),
    display_title: user.display_title,
    avatar: user.avatar,
    created_at: user.created_at,
  };
});

// ==================== Sections ====================

export const sectionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const sections = await store.getPublicSections();
  return sections.filter((s) => s.visible);
});

export const sectionsAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  const [sections, items] = await Promise.all([store.getSections(), store.getItems()]);
  const visible = sections.filter(
    (s) =>
      actor.owner ||
      access.canAnyAt(actor, "sections", { section: s.id }) ||
      access.canAnyAt(actor, "items", { section: s.id }) ||
      access.can(actor, "items.create", { section: s.id }) || // عشان يختار القسم وهو بيضيف عنصر
      items.some((i) => i.section_id === s.id && access.canAnyAt(actor, "items", { section: s.id, item: i.id })),
  );
  // كلمة سر القسم مبتظهرش غير لمن يقدر يعدّلها
  return visible.map((s) =>
    access.can(actor, "sections.edit.password", { section: s.id }) ? s : { ...s, password: s.password ? MASK : null },
  );
});

export const sectionBySlugFn = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    return store.getSectionWithItems(slug);
  });

export const unlockSectionFn = createServerFn({ method: "POST" })
  .validator((d: { slug: string; password: string }) => d)
  .handler(async ({ data }) => {
    const items = await store.unlockSection(data.slug, data.password);
    if (items === null) return { error: "كلمة السر غلط" };
    return { items };
  });

export const saveSectionFn = createServerFn({ method: "POST" })
  .validator((d: Partial<store.Section>) => d)
  .handler(async ({ data: raw }) => {
    const actor = await requireActor();
    const data = unmask(raw);
    if (data.id) {
      const existing = (await store.getSections()).find((s) => s.id === data.id);
      if (!existing) throw new Error("القسم غير موجود");
      // كل حقل اتغيّر لازم يكون عند الشخص صلاحيته، والباقي بيتتجاهل
      const groups = changedGroups(SECTION_FIELDS, existing, data);
      if (groups.length === 0) return existing;
      access.assertCanGroups(actor, "sections.edit", groups, { section: existing.id });
      const patch: Record<string, unknown> = { id: existing.id };
      for (const g of groups) for (const f of g.fields) if (f in data) patch[f] = (data as Record<string, unknown>)[f];
      const saved = await store.saveSection(patch as Partial<store.Section>);
      await audit.logAdmin(actor, {
        category: "sections", action: "section.update", summary: `عدّل القسم «${existing.name}»`,
        target: existing.name, changes: audit.buildChanges(groups, existing, patch),
      });
      return saved;
    }
    access.assertCan(actor, "sections.create");
    const created = await store.saveSection(data);
    if (!actor.owner) await auth.addGrants(actor.user.id, [wildcardKey("section", created.id)]); // اللي عمل القسم يديره
    await audit.logAdmin(actor, { category: "sections", action: "section.create", summary: `أنشأ قسم «${created.name}»`, target: created.name });
    return created;
  });

export const deleteSectionFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const existing = (await store.getSections()).find((s) => s.id === id);
    if (!existing) return {};
    access.assertCan(actor, "sections.delete", { section: id });
    const count = (await store.getItems()).filter((i) => i.section_id === id).length;
    await store.deleteSection(id);
    await audit.logAdmin(actor, {
      category: "sections", action: "section.delete", summary: `حذف القسم «${existing.name}»`, target: existing.name,
      note: count ? `اتحذف معاه ${count} عنصر` : null,
    });
    return {};
  });

// ==================== Items ====================

export const itemsAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  const items = await store.getItems();
  const visible = actor.owner ? items : items.filter((i) => access.canAnyAt(actor, "items", { section: i.section_id, item: i.id }));
  return visible.map((i) =>
    access.can(actor, "items.edit.password", { section: i.section_id, item: i.id }) ? i : { ...i, password: i.password ? MASK : null },
  );
});

export const itemByIdFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; password?: string }) => d)
  .handler(async ({ data }) => {
    return store.getItemWithSection(data.id, data.password);
  });

export const saveItemFn = createServerFn({ method: "POST" })
  .validator((d: Partial<store.Item>) => d)
  .handler(async ({ data: raw }) => {
    const actor = await requireActor();
    const data = unmask(raw);
    if (data.id) {
      const existing = (await store.getItems()).find((i) => i.id === data.id);
      if (!existing) throw new Error("العنصر غير موجود");
      const scope = { section: existing.section_id, item: existing.id };
      const groups = changedGroups(ITEM_FIELDS, existing, data);
      if (groups.length === 0) return existing;
      access.assertCanGroups(actor, "items.edit", groups, scope);
      if (groups.some((g) => g.id === "section") && data.section_id) {
        access.assertCan(actor, "items.create", { section: data.section_id });
      }
      const patch: Record<string, unknown> = { id: existing.id };
      for (const g of groups) for (const f of g.fields) if (f in data) patch[f] = (data as Record<string, unknown>)[f];
      const saved = await store.saveItem(patch as Partial<store.Item>);
      await audit.logAdmin(actor, {
        category: "items", action: "item.update", summary: `عدّل العنصر «${existing.title}»`,
        target: existing.title, changes: audit.buildChanges(groups, existing, patch),
      });
      return saved;
    }
    if (!data.section_id) throw new Error("القسم مطلوب");
    access.assertCan(actor, "items.create", { section: data.section_id });
    const created = await store.saveItem(data);
    if (!actor.owner) await auth.addGrants(actor.user.id, [wildcardKey("item", created.id)]);
    await audit.logAdmin(actor, { category: "items", action: "item.create", summary: `أضاف عنصر «${created.title}»`, target: created.title });
    return created;
  });

export const deleteItemFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const existing = (await store.getItems()).find((i) => i.id === id);
    if (!existing) return {};
    access.assertCan(actor, "items.delete", { section: existing.section_id, item: existing.id });
    await store.deleteItem(id);
    await audit.logAdmin(actor, { category: "items", action: "item.delete", summary: `حذف العنصر «${existing.title}»`, target: existing.title });
    return {};
  });

export const toggleItemPublishedFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; published: boolean }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const existing = (await store.getItems()).find((i) => i.id === data.id);
    if (!existing) throw new Error("العنصر غير موجود");
    access.assertCan(actor, "items.edit.published", { section: existing.section_id, item: existing.id });
    const saved = await store.toggleItemPublished(data.id, data.published);
    await audit.logAdmin(actor, {
      category: "items", action: "item.publish", summary: `${data.published ? "نشر" : "أخفى"} العنصر «${existing.title}»`, target: existing.title,
    });
    return saved;
  });

async function itemForTopics(actor: access.Actor, itemId: string, perms: string[]) {
  const item = (await store.getItems()).find((i) => i.id === itemId);
  if (!item) throw new Error("العنصر غير موجود");
  const scope = { section: item.section_id, item: item.id };
  access.assertCanAnyAt(actor, perms, scope);
  return { item, scope };
}

// ==================== Topics (مواضيع الدورة الفرعية) ====================

export const topicsByItemFn = createServerFn({ method: "POST" })
  .validator((d: { itemId: string; password?: string }) => d)
  .handler(async ({ data }) => {
    const detail = await store.getItemWithSection(data.itemId, data.password);
    if (!detail || detail.locked) return [];
    return store.getTopicsByItem(data.itemId);
  });

export const topicsByItemAdminFn = createServerFn({ method: "GET" })
  .validator((itemId: string) => itemId)
  .handler(async ({ data: itemId }) => {
    const actor = await requireActor();
    await itemForTopics(actor, itemId, ["items.topics", "items.edit"]);
    return store.getTopicsByItem(itemId);
  });

export const saveTopicFn = createServerFn({ method: "POST" })
  .validator((d: Partial<store.Topic>) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    if (data.id) {
      const topic = await store.getTopic(data.id);
      if (!topic) throw new Error("الموضوع غير موجود");
      const { item, scope } = await itemForTopics(actor, topic.item_id, ["items.topics"]);
      const groups = changedGroups(TOPIC_FIELDS, topic, data);
      if (groups.length === 0) return topic;
      access.assertCanGroups(actor, "items.topics.edit", groups, scope);
      const patch: Record<string, unknown> = { id: topic.id };
      for (const g of groups) for (const f of g.fields) if (f in data) patch[f] = (data as Record<string, unknown>)[f];
      const saved = await store.saveTopic(patch as Partial<store.Topic>);
      await audit.logAdmin(actor, {
        category: "topics", action: "topic.update", summary: `عدّل موضوع «${topic.title}» في «${item.title}»`,
        target: topic.title, changes: audit.buildChanges(groups, topic, patch),
      });
      return saved;
    }
    if (!data.item_id) throw new Error("العنصر مطلوب");
    const { item, scope } = await itemForTopics(actor, data.item_id, ["items.topics"]);
    access.assertCan(actor, "items.topics.create", scope);
    const created = await store.saveTopic(data);
    await audit.logAdmin(actor, { category: "topics", action: "topic.create", summary: `أضاف موضوع «${created.title}» في «${item.title}»`, target: created.title });
    return created;
  });

export const deleteTopicFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const topic = await store.getTopic(id);
    if (!topic) return {};
    const { item, scope } = await itemForTopics(actor, topic.item_id, ["items.topics"]);
    access.assertCan(actor, "items.topics.delete", scope);
    await store.deleteTopic(id);
    await audit.logAdmin(actor, { category: "topics", action: "topic.delete", summary: `حذف موضوع «${topic.title}» من «${item.title}»`, target: topic.title });
    return {};
  });

// ==================== Uploads (على Supabase Storage — bucket اسمه media) ====================
// الإعداد المطلوب في Supabase: Storage -> Create bucket -> اسمه "media" -> Public bucket: ON.

let storageClient: ReturnType<typeof createClient> | null = null;
function getStorageClient() {
  if (!storageClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("متغيرات SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY مش موجودة على السيرفر.");
    }
    storageClient = createClient(url, key, { auth: { persistSession: false } });
  }
  return storageClient;
}

export const uploadFileFn = createServerFn({ method: "POST" })
  .validator((d: FormData) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCanAny(actor, ["items.create", "items.edit", "items.topics", "sections.create", "sections.edit"]);
    const file = data.get("file");
    if (!(file instanceof File)) throw new Error("لا يوجد ملف مرفوع");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    if (USE_LOCAL_STORAGE) {
      // رفع محلي: بيتحفظ في public/uploads ويتخدم من /uploads/...
      const dir = path.resolve(process.cwd(), "public", "uploads");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buffer);
      await audit.logAdmin(actor, { category: "uploads", action: "file.upload", summary: `رفع ملف «${file.name}»`, target: file.name, note: `${Math.round(buffer.length / 1024)} كيلوبايت` });
      return { url: `/uploads/${filename}` };
    }

    const supabase = getStorageClient();
    const { error } = await supabase.storage.from("media").upload(filename, buffer, {
      contentType: file.type || "application/octet-stream",
    });
    if (error) throw new Error(`فشل رفع الصورة: ${error.message}`);

    const { data: pub } = supabase.storage.from("media").getPublicUrl(filename);
    await audit.logAdmin(actor, { category: "uploads", action: "file.upload", summary: `رفع ملف «${file.name}»`, target: file.name, note: `${Math.round(buffer.length / 1024)} كيلوبايت` });
    return { url: pub.publicUrl };
  });
