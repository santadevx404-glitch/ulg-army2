// الإعلانات: إعلان بعنوان ونص وصورة ورابط، بيظهر في أماكن بتحددها ولجمهور بتحدده وفي وقت بتحدده.
// التخزين عن طريق kv-store (ملفات data/ دلوقتي، وSupabase بعدين).
import crypto from "node:crypto";
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";
import { makeImageStore, isValidImageName } from "./image-store.server";

const KEY = "bwd:announcements";
export const MAX_ANNOUNCEMENT_IMAGE_BYTES = 4 * 1024 * 1024; // حد Vercel لحجم الطلب ~4.5 ميجا
export const announcementImages = makeImageStore("announcement-images", MAX_ANNOUNCEMENT_IMAGE_BYTES);

export type Tone = "info" | "success" | "warning" | "danger";
export type Audience = "everyone" | "members" | "ranks";
const TONES: Tone[] = ["info", "success", "warning", "danger"];
const AUDIENCES: Audience[] = ["everyone", "members", "ranks"];

export type Announcement = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  image: string | null; // اسم ملف الصورة
  /** أماكن الظهور: all (كل الصفحات) | home | exams | chat | section:<id> | item:<id> */
  targets: string[];
  audience: Audience; // everyone = الكل | members = المسجّلين بس | ranks = أصحاب رتب معينة
  rank_ids: string[];
  tone: Tone;
  open_by_default: boolean; // يتفتح لوحده ولا يستنى السهم
  dismissible: boolean; // الشخص يقدر يقفله
  starts_at: string | null;
  ends_at: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const withLock = makeLock();

async function read(): Promise<Announcement[]> {
  const raw = await kvGetJSON<{ items?: Announcement[] }>(KEY, { items: [] });
  return (raw.items ?? []).map(normalize);
}
async function write(items: Announcement[]) {
  await kvSetJSON(KEY, { items });
}

function normalize(a: Partial<Announcement>): Announcement {
  const now = new Date().toISOString();
  return {
    id: a.id ?? crypto.randomUUID(),
    title: a.title ?? "",
    body: a.body ?? "",
    link_url: a.link_url ?? null,
    link_label: a.link_label ?? null,
    image: a.image ?? null,
    targets: Array.isArray(a.targets) ? a.targets : ["all"],
    audience: AUDIENCES.includes(a.audience as Audience) ? (a.audience as Audience) : "everyone",
    rank_ids: Array.isArray(a.rank_ids) ? a.rank_ids : [],
    tone: TONES.includes(a.tone as Tone) ? (a.tone as Tone) : "info",
    open_by_default: a.open_by_default ?? false,
    dismissible: a.dismissible ?? true,
    starts_at: a.starts_at ?? null,
    ends_at: a.ends_at ?? null,
    enabled: a.enabled ?? true,
    sort_order: typeof a.sort_order === "number" ? a.sort_order : 0,
    created_at: a.created_at ?? now,
    updated_at: a.updated_at ?? now,
  };
}

/** الرابط لازم يكون http(s) أو مسار داخلي — أي حاجة تانية (javascript: مثلًا) بتتشال. */
export function safeLink(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > 500) return null;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (s.startsWith("/") && !s.startsWith("//") && !/[\s\\]/.test(s)) return s;
  return null;
}

const TARGET_RE = /^(all|home|exams|chat|section:[A-Za-z0-9_-]+|item:[A-Za-z0-9_-]+)$/;
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export async function listAnnouncements(): Promise<Announcement[]> {
  return (await read()).sort((a, b) => a.sort_order - b.sort_order || b.created_at.localeCompare(a.created_at));
}
export async function getAnnouncement(id: string): Promise<Announcement | null> {
  return (await read()).find((a) => a.id === id) ?? null;
}

export type AnnouncementInput = Partial<Omit<Announcement, "created_at" | "updated_at">>;

export async function saveAnnouncement(input: AnnouncementInput, validRankIds: Set<string>): Promise<Announcement> {
  return withLock(async () => {
    const items = await read();
    const idx = input.id ? items.findIndex((a) => a.id === input.id) : -1;
    const prev = idx >= 0 ? items[idx] : null;
    // القيمة من الطلب لو موجودة، وإلا من الإعلان الحالي
    const pick = (k: keyof Announcement): unknown =>
      k in input ? (input as Record<string, unknown>)[k] : prev ? (prev as unknown as Record<string, unknown>)[k] : undefined;

    const title = String(pick("title") ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!title) throw new Error("عنوان الإعلان مطلوب");
    const body = String(pick("body") ?? "").trim().slice(0, 4000);
    const link_url = safeLink(pick("link_url"));
    const link_label = link_url ? String(pick("link_label") ?? "").trim().slice(0, 40) || "المزيد" : null;

    const targets = [...new Set(((pick("targets") as string[] | undefined) ?? ["all"]).filter((t) => typeof t === "string" && TARGET_RE.test(t)))];
    if (targets.length === 0) throw new Error("اختار مكان واحد على الأقل يظهر فيه الإعلان");

    const audience = (pick("audience") as Audience | undefined) ?? "everyone";
    if (!AUDIENCES.includes(audience)) throw new Error("الجمهور غير صحيح");
    const rank_ids = [...new Set(((pick("rank_ids") as string[] | undefined) ?? []).filter((id) => validRankIds.has(id)))];
    if (audience === "ranks" && rank_ids.length === 0) throw new Error("اختار رتبة واحدة على الأقل");

    const tone = (pick("tone") as Tone | undefined) ?? "info";
    if (!TONES.includes(tone)) throw new Error("اللون غير صحيح");

    const starts_at = isoOrNull(pick("starts_at"));
    const ends_at = isoOrNull(pick("ends_at"));
    if (starts_at && ends_at && Date.parse(ends_at) <= Date.parse(starts_at)) throw new Error("وقت النهاية لازم يكون بعد البداية");

    // الصورة: لازم تكون ملف موجود فعلًا (اترفع قبل كده)
    const image = (pick("image") as string | null | undefined) ?? null;
    if (image !== null && !(isValidImageName(image) && (await announcementImages.exists(image)))) throw new Error("الصورة غير موجودة، ارفعها تاني");

    const now = new Date().toISOString();
    const next: Announcement = {
      id: prev?.id ?? crypto.randomUUID(),
      title, body, link_url, link_label, image, targets, audience, rank_ids, tone,
      open_by_default: !!(pick("open_by_default") ?? false),
      dismissible: pick("dismissible") === undefined ? true : !!pick("dismissible"),
      starts_at, ends_at,
      enabled: pick("enabled") === undefined ? true : !!pick("enabled"),
      sort_order: Math.floor(Number(pick("sort_order") ?? 0)) || 0,
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    if (prev) items[idx] = next; else items.push(next);
    await write(items);
    if (prev?.image && prev.image !== next.image) await announcementImages.remove([prev.image]); // صورة قديمة اتبدّلت
    return next;
  });
}

export async function deleteAnnouncement(id: string): Promise<Announcement | null> {
  return withLock(async () => {
    const items = await read();
    const a = items.find((x) => x.id === id) ?? null;
    if (!a) return null;
    await write(items.filter((x) => x.id !== id));
    await announcementImages.remove([a.image]);
    return a;
  });
}

/** لما رتبة تتمسح بتتشال من جمهور الإعلانات. */
export async function removeRankFromAnnouncements(rankId: string): Promise<void> {
  await withLock(async () => {
    const items = await read();
    let dirty = false;
    for (const a of items) {
      if (a.rank_ids.includes(rankId)) {
        a.rank_ids = a.rank_ids.filter((r) => r !== rankId);
        if (a.audience === "ranks" && a.rank_ids.length === 0) a.enabled = false; // مفيش حد يشوفه — نوقفه بدل ما يتحول لإعلان للكل
        dirty = true;
      }
    }
    if (dirty) await write(items);
  });
}

export type Viewer = { loggedIn: boolean; owner: boolean; rank_ids: string[] };

export type PublicAnnouncement = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  image: string | null;
  tone: Tone;
  open_by_default: boolean;
  dismissible: boolean;
  updated_at: string;
};

/** الإعلانات اللي تظهر دلوقتي في الأماكن دي لزائر معين. */
export async function activeFor(tokens: string[], viewer: Viewer, now = Date.now()): Promise<PublicAnnouncement[]> {
  if (tokens.length === 0) return [];
  const set = new Set(tokens);
  return (await listAnnouncements())
    .filter((a) => {
      if (!a.enabled) return false;
      if (a.starts_at && now < Date.parse(a.starts_at)) return false;
      if (a.ends_at && now >= Date.parse(a.ends_at)) return false;
      if (!a.targets.some((t) => set.has(t))) return false;
      if (viewer.owner) return true;
      if (a.audience === "members") return viewer.loggedIn;
      if (a.audience === "ranks") return viewer.loggedIn && a.rank_ids.some((id) => viewer.rank_ids.includes(id));
      return true;
    })
    .map((a) => ({
      id: a.id, title: a.title, body: a.body, link_url: a.link_url, link_label: a.link_label, image: a.image,
      tone: a.tone, open_by_default: a.open_by_default, dismissible: a.dismissible, updated_at: a.updated_at,
    }));
}
