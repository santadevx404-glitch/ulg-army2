// تخزين البيانات في Supabase بدل ملفات محلية — عشان يشتغل على منصات
// serverless زي Vercel اللي مالهاش قرص دائم قابل للكتابة. راجع kv-store.server.ts
// لتفاصيل الإعداد المطلوب على Vercel.
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON } from "./kv-store.server";

const DB_KEY = "bwd:db";

export type Section = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  sort_order: number;
  visible: boolean;
  password: string | null;
};

export type PublicSection = Omit<Section, "password"> & { locked: boolean };

export type GalleryImage = { url: string; caption: string };

export type Item = {
  id: string;
  section_id: string;
  title: string;
  short_description: string | null;
  full_description: string | null;
  cover_image: string | null;
  gallery: GalleryImage[];
  published: boolean;
  sort_order: number;
  use_topics: boolean;
  password: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicItem = Omit<Item, "password"> & { locked: boolean };

export type PublicItemDetail =
  | { locked: true; id: string; title: string; section_name: string }
  | ({ locked: false } & Omit<Item, "password"> & { sections: { name: string; slug: string } });

export type Topic = {
  id: string;
  item_id: string;
  title: string;
  content: string;
  images: GalleryImage[];
  sort_order: number;
};

type DB = { sections: Section[]; items: Item[]; topics: Topic[] };

const DEFAULT_DB: DB = {
  sections: [
    { id: "sec-achievements", slug: "achievements", name: "إنجازات حرس الحدود", icon: "Award", sort_order: 1, visible: true, password: null },
    { id: "sec-weapons", slug: "weapons", name: "قسم الأسلحة", icon: "Crosshair", sort_order: 2, visible: true, password: null },
    { id: "sec-vehicles", slug: "vehicles", name: "قسم السيارات", icon: "Truck", sort_order: 3, visible: true, password: null },
    { id: "sec-courses", slug: "courses", name: "قسم الدورات", icon: "GraduationCap", sort_order: 4, visible: true, password: null },
    { id: "sec-locations", slug: "locations", name: "الأماكن المعتمدة", icon: "MapPin", sort_order: 5, visible: true, password: null },
  ],
  items: [],
  topics: [],
};

// طابور بسيط عشان لو جت طلبات كتابة في نفس اللحظة متفسدش بعض
let writeQueue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeGallery(g: unknown): GalleryImage[] {
  if (!Array.isArray(g)) return [];
  return g.map((entry) =>
    typeof entry === "string" ? { url: entry, caption: "" } : { caption: "", ...(entry as GalleryImage) },
  );
}

async function readDb(): Promise<DB> {
  const parsed = await kvGetJSON<Partial<DB>>(DB_KEY, DEFAULT_DB);
  return {
    sections: (parsed.sections ?? []).map((s) => ({ password: null, ...s })),
    items: (parsed.items ?? []).map((i) => ({ password: null, ...i, gallery: normalizeGallery(i.gallery) })),
    topics: (parsed.topics ?? []).map((t) => ({ ...t, images: normalizeGallery((t as any).images) })),
  };
}

function sanitizeSection(s: Section): PublicSection {
  const { password, ...rest } = s;
  return { ...rest, locked: !!password };
}

function sanitizeItem(i: Item): PublicItem {
  const { password, ...rest } = i;
  return { ...rest, locked: !!password };
}

async function writeDb(db: DB): Promise<void> {
  await kvSetJSON(DB_KEY, db);
}

// ---------------- Sections ----------------

export async function getSections(): Promise<Section[]> {
  const db = await readDb();
  return [...db.sections].sort((a, b) => a.sort_order - b.sort_order);
}

export async function getPublicSections(): Promise<PublicSection[]> {
  const sections = await getSections();
  return sections.map(sanitizeSection);
}

export async function getSectionWithItems(
  slug: string,
): Promise<{ section: PublicSection | null; items: PublicItem[] }> {
  const db = await readDb();
  const raw = db.sections.find((s) => s.slug === slug) ?? null;
  if (!raw) return { section: null, items: [] };
  const section = sanitizeSection(raw);
  if (section.locked) {
    // القسم مقفول بكلمة سر — منسيبش العناصر توصل للمتصفح قبل التحقق
    return { section, items: [] };
  }
  const items = db.items
    .filter((i) => i.section_id === raw.id && i.published)
    .sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at))
    .map(sanitizeItem);
  return { section, items };
}

export async function unlockSection(slug: string, password: string): Promise<PublicItem[] | null> {
  const db = await readDb();
  const raw = db.sections.find((s) => s.slug === slug);
  if (!raw) return null;
  if (raw.password && raw.password !== password) return null;
  return db.items
    .filter((i) => i.section_id === raw.id && i.published)
    .sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at))
    .map(sanitizeItem);
}

export async function saveSection(payload: Partial<Section>): Promise<Section> {
  return withLock(async () => {
    const db = await readDb();
    if (payload.id) {
      const idx = db.sections.findIndex((s) => s.id === payload.id);
      if (idx === -1) throw new Error("القسم غير موجود");
      db.sections[idx] = { ...db.sections[idx], ...payload } as Section;
      await writeDb(db);
      return db.sections[idx];
    }
    const section: Section = {
      id: crypto.randomUUID(),
      slug: payload.slug ?? "",
      name: payload.name ?? "",
      icon: payload.icon ?? null,
      sort_order: payload.sort_order ?? db.sections.length + 1,
      visible: payload.visible ?? true,
      password: payload.password?.trim() ? payload.password.trim() : null,
    };
    if (db.sections.some((s) => s.slug === section.slug)) {
      throw new Error("المُعرِّف ده مستخدم بالفعل");
    }
    db.sections.push(section);
    await writeDb(db);
    return section;
  });
}

export async function deleteSection(id: string): Promise<void> {
  return withLock(async () => {
    const db = await readDb();
    db.sections = db.sections.filter((s) => s.id !== id);
    db.items = db.items.filter((i) => i.section_id !== id); // زي الأصل: حذف القسم بيحذف عناصره
    await writeDb(db);
  });
}

// ---------------- Items ----------------

export async function getItems(): Promise<Item[]> {
  const db = await readDb();
  return [...db.items].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getItemWithSection(
  id: string,
  password?: string,
): Promise<PublicItemDetail | null> {
  const db = await readDb();
  const item = db.items.find((i) => i.id === id);
  if (!item) return null;
  const section = db.sections.find((s) => s.id === item.section_id);
  if (item.password && item.password !== password) {
    return { locked: true, id: item.id, title: item.title, section_name: section?.name ?? "" };
  }
  const { password: _pw, ...rest } = item;
  return { locked: false, ...rest, sections: { name: section?.name ?? "", slug: section?.slug ?? "" } };
}

export async function saveItem(payload: Partial<Item>): Promise<Item> {
  return withLock(async () => {
    const db = await readDb();
    const now = new Date().toISOString();
    if (payload.id) {
      const idx = db.items.findIndex((i) => i.id === payload.id);
      if (idx === -1) throw new Error("العنصر غير موجود");
      db.items[idx] = { ...db.items[idx], ...payload, updated_at: now } as Item;
      await writeDb(db);
      return db.items[idx];
    }
    const item: Item = {
      id: crypto.randomUUID(),
      section_id: payload.section_id ?? "",
      title: payload.title ?? "",
      short_description: payload.short_description ?? null,
      full_description: payload.full_description ?? null,
      cover_image: payload.cover_image ?? null,
      gallery: payload.gallery ?? [],
      published: payload.published ?? true,
      sort_order: payload.sort_order ?? 0,
      use_topics: payload.use_topics ?? false,
      password: payload.password?.trim() ? payload.password.trim() : null,
      created_at: now,
      updated_at: now,
    };
    db.items.push(item);
    await writeDb(db);
    return item;
  });
}

export async function deleteItem(id: string): Promise<void> {
  return withLock(async () => {
    const db = await readDb();
    db.items = db.items.filter((i) => i.id !== id);
    db.topics = db.topics.filter((t) => t.item_id !== id);
    await writeDb(db);
  });
}

export async function toggleItemPublished(id: string, published: boolean): Promise<Item> {
  return withLock(async () => {
    const db = await readDb();
    const idx = db.items.findIndex((i) => i.id === id);
    if (idx === -1) throw new Error("العنصر غير موجود");
    db.items[idx] = { ...db.items[idx], published, updated_at: new Date().toISOString() };
    await writeDb(db);
    return db.items[idx];
  });
}

// ---------------- Topics (مواضيع القسم الفرعية داخل عنصر، زي مواضيع الدورة) ----------------

export async function getTopicsByItem(itemId: string): Promise<Topic[]> {
  const db = await readDb();
  return db.topics
    .filter((t) => t.item_id === itemId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function saveTopic(payload: Partial<Topic>): Promise<Topic> {
  return withLock(async () => {
    const db = await readDb();
    if (payload.id) {
      const idx = db.topics.findIndex((t) => t.id === payload.id);
      if (idx === -1) throw new Error("الموضوع غير موجود");
      db.topics[idx] = { ...db.topics[idx], ...payload } as Topic;
      await writeDb(db);
      return db.topics[idx];
    }
    const topic: Topic = {
      id: crypto.randomUUID(),
      item_id: payload.item_id ?? "",
      title: payload.title ?? "",
      content: payload.content ?? "",
      images: payload.images ?? [],
      sort_order: payload.sort_order ?? 0,
    };
    db.topics.push(topic);
    await writeDb(db);
    return topic;
  });
}

export async function deleteTopic(id: string): Promise<void> {
  return withLock(async () => {
    const db = await readDb();
    db.topics = db.topics.filter((t) => t.id !== id);
    await writeDb(db);
  });
}
