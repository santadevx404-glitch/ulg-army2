import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import * as auth from "./local-auth.server";
import * as store from "./local-store.server";

async function currentUserId(): Promise<string | null> {
  const token = getCookie(auth.SESSION_COOKIE);
  return auth.verifySessionToken(token);
}

async function requireAdmin() {
  const uid = await currentUserId();
  if (!uid) throw new Error("غير مسجل الدخول");
  const user = await auth.getUserById(uid);
  if (!user) throw new Error("غير مسجل الدخول");
  return user;
}

// ==================== Auth ====================

export const signupFn = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    return auth.signup(data.email, data.password);
  });

export const loginFn = createServerFn({ method: "POST" })
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const user = await auth.verifyLogin(data.email, data.password);
    if (!user) return { error: "الإيميل أو كلمة المرور غلط" };
    const token = await auth.createSessionToken(user.id);
    setCookie(auth.SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: auth.SESSION_MAX_AGE,
    });
    return { email: user.email };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(auth.SESSION_COOKIE, { path: "/" });
  return {};
});

export const currentUserFn = createServerFn({ method: "GET" }).handler(async () => {
  const uid = await currentUserId();
  if (!uid) return null;
  const user = await auth.getUserById(uid);
  if (!user) return null;
  return { email: user.email, role: user.role };
});

// ==================== Sections ====================

export const sectionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const sections = await store.getPublicSections();
  return sections.filter((s) => s.visible);
});

export const sectionsAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return store.getSections();
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
  .handler(async ({ data }) => {
    await requireAdmin();
    return store.saveSection(data);
  });

export const deleteSectionFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdmin();
    await store.deleteSection(id);
    return {};
  });

// ==================== Items ====================

export const itemsAdminFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return store.getItems();
});

export const itemByIdFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; password?: string }) => d)
  .handler(async ({ data }) => {
    return store.getItemWithSection(data.id, data.password);
  });

export const saveItemFn = createServerFn({ method: "POST" })
  .validator((d: Partial<store.Item>) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    return store.saveItem(data);
  });

export const deleteItemFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdmin();
    await store.deleteItem(id);
    return {};
  });

export const toggleItemPublishedFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; published: boolean }) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    return store.toggleItemPublished(data.id, data.published);
  });

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
    await requireAdmin();
    return store.getTopicsByItem(itemId);
  });

export const saveTopicFn = createServerFn({ method: "POST" })
  .validator((d: Partial<store.Topic>) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    return store.saveTopic(data);
  });

export const deleteTopicFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireAdmin();
    await store.deleteTopic(id);
    return {};
  });

// ==================== Uploads (على القرص المحلي، جوه public/uploads) ====================

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

export const uploadFileFn = createServerFn({ method: "POST" })
  .validator((d: FormData) => d)
  .handler(async ({ data }) => {
    await requireAdmin();
    const file = data.get("file");
    if (!(file instanceof File)) throw new Error("لا يوجد ملف مرفوع");

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${crypto.randomUUID()}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);

    return { url: `/uploads/${filename}` };
  });
