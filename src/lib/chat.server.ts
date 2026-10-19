// الدردشات: كل دردشة مربوطة برتب، والرسايل بتتخزن مع بيانات الكاتب وقت الإرسال.
// الصور: بتترفع الأول (بتتسجل باسم الرافع والدردشة)، وبعدين الرسالة بتستهلكها.
// التخزين عن طريق kv-store (ملفات data/ دلوقتي، وSupabase بعدين).
import crypto from "node:crypto";
import { kvGetJSON, kvGetJSONShared, kvSetJSON, makeLock } from "./kv-store.server";
import { makeImageStore } from "./image-store.server";

const CHATS_KEY = "bwd:chats";
const MSGS_KEY = "bwd:chat-messages";
const UPLOADS_KEY = "bwd:chat-uploads";
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024; // حد Vercel لحجم الطلب ~4.5 ميجا
const MAX_PER_CHAT = 1000; // آخر 1000 رسالة في كل دردشة
const STALE_UPLOAD_MS = 2 * 60 * 60 * 1000; // الصورة اللي اترفعت ومتبعتتش بتتمسح بعد ساعتين

export const chatImages = makeImageStore("chat-images", MAX_CHAT_IMAGE_BYTES);

export type Chat = {
  id: string;
  name: string;
  description: string;
  rank_ids: string[]; // الرتب اللي تقدر تفتح الدردشة
  rank_display_order: string[]; // ترتيب خاص بالدردشة دي للرتبة اللي تظهر جنب الاسم (فاضي = الترتيب العام)
  allow_images: boolean; // السماح بإرسال الصور
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  seq: number;
  author_id: string;
  code: string; // الكود العسكري وقت الإرسال
  character: string; // اسم الشخصية وقت الإرسال
  rank: string; // الرتبة وقت الإرسال
  text: string;
  images: string[]; // أسماء ملفات الصور
  private_images?: string[]; // الصور اللي الكاتب خلاها برايفت (من غير تحميل + حماية من السكرين)
  at: string;
};

type MsgStore = Record<string, { next: number; messages: ChatMessage[] }>;
type UploadReg = Record<string, { user_id: string; chat_id: string; used: boolean; at: string; private?: boolean }>;

const withLock = makeLock();

/** يقدر يفتح الدردشة؟ صاحب الموقع دايمًا، وغيره لازم الدردشة تكون شغالة ومعاه إحدى رتبها. */
export function canOpenChat(actor: { owner: boolean; user: { rank_ids: string[] } }, c: Chat): boolean {
  if (actor.owner) return true;
  return c.enabled && c.rank_ids.some((id) => actor.user.rank_ids.includes(id));
}

async function readChats(): Promise<Chat[]> {
  const raw = await kvGetJSON<{ chats?: Chat[] }>(CHATS_KEY, { chats: [] });
  return normalizeChats(raw.chats ?? []);
}
async function writeChats(chats: Chat[]) {
  await kvSetJSON(CHATS_KEY, { chats });
}
async function readMsgs(): Promise<MsgStore> {
  return kvGetJSON<MsgStore>(MSGS_KEY, {});
}
async function writeMsgs(m: MsgStore) {
  await kvSetJSON(MSGS_KEY, m);
}
async function readUploads(): Promise<UploadReg> {
  return kvGetJSON<UploadReg>(UPLOADS_KEY, {});
}
async function writeUploads(u: UploadReg) {
  await kvSetJSON(UPLOADS_KEY, u);
}
const withImages = (m: ChatMessage): ChatMessage => ({ ...m, images: m.images ?? [], private_images: (m.private_images ?? []).filter((n) => (m.images ?? []).includes(n)) });

// قراءات للعرض بس (polling): مشتركة بين الطلبات ومتخزنة لحظات قليلة عشان الدردشة متبقاش تقيلة
async function readMsgsShared(): Promise<MsgStore> {
  return kvGetJSONShared<MsgStore>(MSGS_KEY, {});
}
async function readChatsShared(): Promise<Chat[]> {
  const raw = await kvGetJSONShared<{ chats?: Chat[] }>(CHATS_KEY, { chats: [] });
  return normalizeChats(raw.chats ?? []);
}
function normalizeChats(list: Chat[]): Chat[] {
  return list.map((c) => ({
    ...c,
    description: c.description ?? "",
    rank_ids: c.rank_ids ?? [],
    rank_display_order: c.rank_display_order ?? [],
    allow_images: c.allow_images ?? true,
    enabled: c.enabled ?? true,
  }));
}

export async function listChats(): Promise<Chat[]> {
  return (await readChats()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export async function getChat(id: string): Promise<Chat | null> {
  return (await readChats()).find((c) => c.id === id) ?? null;
}
/** نفس getChat بس من كاش قصير (للعرض والـ polling بس، مش للتعديل). */
export async function getChatFast(id: string): Promise<Chat | null> {
  return (await readChatsShared()).find((c) => c.id === id) ?? null;
}

export async function messageCounts(): Promise<Record<string, number>> {
  const m = await readMsgs();
  return Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.messages.length]));
}

export async function saveChat(
  input: { id?: string; name: string; description?: string; rank_ids?: string[]; rank_display_order?: string[]; allow_images?: boolean; enabled?: boolean },
  validRankIds: Set<string>,
): Promise<Chat> {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) throw new Error("اسم الدردشة مطلوب");
  const description = String(input.description ?? "").trim().slice(0, 200);
  const rank_ids = [...new Set(input.rank_ids ?? [])].filter((id) => validRankIds.has(id));
  const displayOrder = input.rank_display_order === undefined ? undefined : [...new Set(input.rank_display_order)].filter((id) => validRankIds.has(id));
  return withLock(async () => {
    const chats = await readChats();
    if (chats.some((c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase())) throw new Error("في دردشة بنفس الاسم");
    const now = new Date().toISOString();
    const idx = input.id ? chats.findIndex((c) => c.id === input.id) : -1;
    if (idx >= 0) {
      chats[idx] = {
        ...chats[idx], name, description, rank_ids,
        rank_display_order: displayOrder ?? chats[idx].rank_display_order,
        allow_images: input.allow_images ?? chats[idx].allow_images,
        enabled: input.enabled ?? chats[idx].enabled,
        updated_at: now,
      };
      await writeChats(chats);
      return chats[idx];
    }
    const created: Chat = {
      id: crypto.randomUUID(), name, description, rank_ids, rank_display_order: displayOrder ?? [],
      allow_images: input.allow_images ?? true, enabled: input.enabled ?? true, created_at: now, updated_at: now,
    };
    chats.push(created);
    await writeChats(chats);
    return created;
  });
}

/** كل صور دردشة (اللي في الرسايل + اللي اترفعت ومتبعتتش) وبيمسحها من الملفات والسجل. */
async function purgeChatImages(chatId: string, store: MsgStore, uploads: UploadReg): Promise<void> {
  const names = new Set<string>((store[chatId]?.messages ?? []).flatMap((m) => m.images ?? []));
  for (const [name, reg] of Object.entries(uploads)) {
    if (reg.chat_id === chatId) { names.add(name); delete uploads[name]; }
  }
  await chatImages.remove([...names]);
}

export async function deleteChat(id: string): Promise<void> {
  await withLock(async () => {
    const [store, uploads] = await Promise.all([readMsgs(), readUploads()]);
    await purgeChatImages(id, store, uploads);
    delete store[id];
    await writeMsgs(store);
    await writeUploads(uploads);
    await writeChats((await readChats()).filter((c) => c.id !== id));
  });
}

/** لما رتبة تتمسح بتتشال من كل الدردشات. */
export async function removeRankFromChats(rankId: string): Promise<void> {
  await withLock(async () => {
    const chats = await readChats();
    let dirty = false;
    for (const c of chats) {
      if (c.rank_ids.includes(rankId)) { c.rank_ids = c.rank_ids.filter((r) => r !== rankId); dirty = true; }
      if (c.rank_display_order.includes(rankId)) { c.rank_display_order = c.rank_display_order.filter((r) => r !== rankId); dirty = true; }
    }
    if (dirty) await writeChats(chats);
  });
}

/** قراءة واحدة بس للرسايل: الجديدة + ids آخر 100 رسالة + الصور البرايفت فيهم (للـ polling). */
export async function pollMessages(chatId: string, afterSeq?: number): Promise<{ messages: ChatMessage[]; live: { id: string; priv: string[] }[] }> {
  const all = ((await readMsgsShared())[chatId]?.messages ?? []).map(withImages);
  const messages = afterSeq === undefined ? all.slice(-80) : all.filter((m) => m.seq > afterSeq).slice(0, 200);
  const live = all.slice(-100).map((m) => ({ id: m.id, priv: m.private_images ?? [] }));
  return { messages, live };
}

export async function postMessage(chatId: string, m: Omit<ChatMessage, "id" | "seq" | "at">): Promise<ChatMessage> {
  // بنشيل الحروف الخفية/التحكم ونحافظ على الأسطر
  const text = m.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/\n{4,}/g, "\n\n\n").trim();
  const images = [...new Set(m.images ?? [])];
  if (!text && images.length === 0) throw new Error("الرسالة فاضية");
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`الرسالة أطول من ${MAX_MESSAGE_LENGTH} حرف`);
  if (images.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`أقصى عدد صور في الرسالة ${MAX_IMAGES_PER_MESSAGE}`);
  const priv = [...new Set(m.private_images ?? [])].filter((n) => images.includes(n));
  return withLock(async () => {
    // الرسالة النصية العادية مش محتاجة تلمس سجل الصور خالص (أسرع)
    const uploads = images.length ? await readUploads() : null;
    if (uploads) {
      // كل صورة لازم تكون من رفع نفس الشخص في نفس الدردشة ومتستخدمتش قبل كده
      for (const name of images) {
        const reg = uploads[name];
        if (!reg || reg.user_id !== m.author_id || reg.chat_id !== chatId || reg.used) throw new Error("صورة غير صالحة، ارفعها تاني");
      }
      for (const name of images) { uploads[name].used = true; uploads[name].private = priv.includes(name); }
    }
    const store = await readMsgs();
    const entry = store[chatId] ?? { next: 1, messages: [] };
    const msg: ChatMessage = { ...m, text, images, private_images: priv, id: crypto.randomUUID(), seq: entry.next, at: new Date().toISOString() };
    entry.next += 1;
    entry.messages = [...entry.messages, msg].slice(-MAX_PER_CHAT);
    store[chatId] = entry;
    if (uploads) await writeUploads(uploads);
    await writeMsgs(store);
    return msg;
  });
}

/** الكاتب بس يقدر يخلي صورة من رسايله برايفت أو يرجعها عادية. */
export async function setImagePrivate(chatId: string, messageId: string, userId: string, name: string, value: boolean): Promise<string[]> {
  return withLock(async () => {
    const [store, uploads] = await Promise.all([readMsgs(), readUploads()]);
    const msg = store[chatId]?.messages.find((x) => x.id === messageId);
    if (!msg) throw new Error("الرسالة غير موجودة");
    if (msg.author_id !== userId) throw new Error("بس اللي بعت الصورة يقدر يغيّر خصوصيتها");
    if (!(msg.images ?? []).includes(name)) throw new Error("الصورة مش في الرسالة دي");
    const set = new Set(msg.private_images ?? []);
    if (value) set.add(name); else set.delete(name);
    msg.private_images = [...set];
    if (uploads[name]) uploads[name].private = value;
    await writeUploads(uploads);
    await writeMsgs(store);
    return msg.private_images;
  });
}

export async function getMessage(chatId: string, messageId: string): Promise<ChatMessage | null> {
  const m = (await readMsgs())[chatId]?.messages.find((x) => x.id === messageId);
  return m ? withImages(m) : null;
}

export async function deleteMessage(chatId: string, messageId: string): Promise<void> {
  await withLock(async () => {
    const [store, uploads] = await Promise.all([readMsgs(), readUploads()]);
    const entry = store[chatId];
    if (!entry) return;
    const msg = entry.messages.find((x) => x.id === messageId);
    entry.messages = entry.messages.filter((x) => x.id !== messageId);
    for (const n of msg?.images ?? []) delete uploads[n];
    await chatImages.remove(msg?.images ?? []);
    await writeMsgs(store);
    await writeUploads(uploads);
  });
}

export async function clearMessages(chatId: string): Promise<number> {
  return withLock(async () => {
    const [store, uploads] = await Promise.all([readMsgs(), readUploads()]);
    const n = store[chatId]?.messages.length ?? 0;
    await purgeChatImages(chatId, store, uploads);
    if (store[chatId]) store[chatId].messages = []; // الـ seq بيكمّل عشان اللي فاتح الدردشة يشوف المسح
    await writeMsgs(store);
    await writeUploads(uploads);
    return n;
  });
}

/** ids آخر 100 رسالة — بيستخدمها المتصفح عشان يشيل الرسايل اللي اتمسحت. */
export async function liveIds(chatId: string): Promise<string[]> {
  return ((await readMsgs())[chatId]?.messages ?? []).slice(-100).map((m) => m.id);
}

// ============================== رفع الصور ==============================

/** بيسجّل صورة مرفوعة باسم الرافع والدردشة (لسه متبعتتش). وبينضّف القديم اللي متبعتش. */
export async function registerUpload(name: string, userId: string, chatId: string): Promise<void> {
  await withLock(async () => {
    const uploads = await readUploads();
    const cutoff = Date.now() - STALE_UPLOAD_MS;
    const stale = Object.entries(uploads).filter(([, r]) => !r.used && new Date(r.at).getTime() < cutoff).map(([n]) => n);
    for (const n of stale) delete uploads[n];
    await chatImages.remove(stale);
    uploads[name] = { user_id: userId, chat_id: chatId, used: false, at: new Date().toISOString() };
    await writeUploads(uploads);
  });
}

export async function getUpload(name: string, fresh = false): Promise<{ user_id: string; chat_id: string; used: boolean; private: boolean } | null> {
  const all = fresh ? await readUploads() : await kvGetJSONShared<UploadReg>(UPLOADS_KEY, {});
  const r = all[name];
  return r ? { user_id: r.user_id, chat_id: r.chat_id, used: r.used, private: !!r.private } : null;
}

/** الشخص يلغي صورة رفعها ولسه متبعتتش. */
export async function removeOwnUnusedUpload(name: string, userId: string): Promise<boolean> {
  return withLock(async () => {
    const uploads = await readUploads();
    const reg = uploads[name];
    if (!reg || reg.user_id !== userId || reg.used) return false;
    delete uploads[name];
    await chatImages.remove([name]);
    await writeUploads(uploads);
    return true;
  });
}
