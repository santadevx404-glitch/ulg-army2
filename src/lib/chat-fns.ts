// Server functions الدردشات (للأعضاء) + إدارة الدردشات (لوحة التحكم).
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import * as access from "./access.server";
import * as audit from "./audit.server";
import * as chat from "./chat.server";
import { CHAT_FIELDS, changedGroups, wildcardKey } from "./permissions";

async function requireActor(): Promise<access.Actor> {
  const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
  if (!actor) throw new Error("غير مسجل الدخول");
  return actor;
}

/**
 * الرتبة اللي بتظهر جنب الاسم في دردشة معينة: الأعلى حسب ترتيب الدردشة المخصص (لو متحدد)،
 * والرتب اللي مش في الترتيب المخصص بتيجي بعدها بالترتيب العام. `ranks` لازم تكون مرتبة بالترتيب العام.
 */
function shownRank(c: chat.Chat, userRankIds: string[], ranks: access.Rank[]): string | null {
  const mine = ranks.filter((r) => userRankIds.includes(r.id));
  const pos = (id: string) => { const i = c.rank_display_order.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  mine.sort((a, b) => pos(a.id) - pos(b.id)); // sort ثابت، فالمتساوي بيفضل بالترتيب العام
  return mine[0]?.name ?? null;
}

const canOpen = chat.canOpenChat;

async function openChatFor(actor: access.Actor, chatId: string): Promise<chat.Chat> {
  const c = await chat.getChat(chatId);
  if (!c) throw new Error("الدردشة غير موجودة");
  if (!canOpen(actor, c)) throw new Error("الدردشة دي مقفولة، محتاج رتبتها");
  return c;
}

// ==================== الأعضاء ====================

export type ChatListRow = {
  id: string;
  name: string;
  description: string;
  rank_names: string[];
  enabled: boolean;
  open: boolean; // هل المستخدم الحالي يقدر يفتحها
};

/** كل الدردشات ظاهرة لأي حد مسجّل، بس بتتفتح لأصحاب رتبتها بس. */
export const chatsListFn = createServerFn({ method: "GET" }).handler(async (): Promise<ChatListRow[]> => {
  const actor = await requireActor();
  const [chats, ranks] = await Promise.all([chat.listChats(), access.listRanks()]);
  return chats.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    rank_names: c.rank_ids.map((id) => ranks.find((r) => r.id === id)?.name).filter((n): n is string => !!n),
    enabled: c.enabled,
    open: canOpen(actor, c),
  }));
});

export type ChatMessageRow = {
  id: string;
  seq: number;
  author_id: string;
  code: string;
  character: string;
  rank: string;
  avatar: string | null;
  text: string;
  at: string;
  images: string[];
  mine: boolean;
  can_delete: boolean;
};

export const chatMessagesFn = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; after?: number }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const c = await openChatFor(actor, data.chatId);
    const [msgs, users, ids, ranks] = await Promise.all([
      chat.listMessages(c.id, typeof data.after === "number" ? data.after : undefined),
      auth.listUsers(),
      chat.liveIds(c.id),
      access.listRanks(),
    ]);
    const avatars = new Map(users.map((u) => [u.id, u.avatar]));
    // الرتبة اللي بتظهر جنب الاسم = أعلى رتبة (حسب ترتيب الرتب) عند الشخص دلوقتي. لو ملوش رتب بنستخدم اللي اتسجلت وقت الإرسال.
    const topRank = new Map<string, string>();
    for (const u of users) {
      if (auth.isOwner(u)) continue;
      const name = shownRank(c, u.rank_ids, ranks); // الترتيب المخصص للدردشة دي، وإلا العام
      if (name) topRank.set(u.id, name);
    }
    const canModerate = access.can(actor, "chats.moderate.delete_message", { chat: c.id });
    const messages: ChatMessageRow[] = msgs.map((m) => ({
      ...m,
      avatar: avatars.get(m.author_id) ?? null,
      rank: topRank.get(m.author_id) ?? m.rank,
      mine: m.author_id === actor.user.id,
      can_delete: m.author_id === actor.user.id || canModerate,
    }));
    return {
      chat: { id: c.id, name: c.name, description: c.description, allow_images: c.allow_images, rank_names: c.rank_ids.map((id) => ranks.find((r) => r.id === id)?.name).filter((n): n is string => !!n) },
      messages,
      live_ids: ids,
      can_clear: access.can(actor, "chats.moderate.clear", { chat: c.id }),
    };
  });

// حماية من الإغراق: رسالة كل 700ms وحد أقصى 20 رسالة كل 30 ثانية لكل شخص
const sent = new Map<string, number[]>();

export const sendMessageFn = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; text?: string; images?: string[] }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const c = await openChatFor(actor, data.chatId);
    const images = data.images ?? [];
    if (images.length > 0 && !c.allow_images) throw new Error("إرسال الصور موقوف في الدردشة دي");

    const now = Date.now();
    const recent = (sent.get(actor.user.id) ?? []).filter((t) => now - t < 30_000);
    if (recent.length && now - recent[recent.length - 1] < 700) throw new Error("براحة شوية، استنى لحظة");
    if (recent.length >= 20) throw new Error("رسايل كتير في وقت قصير، استنى شوية");
    sent.set(actor.user.id, [...recent, now]);

    const u = actor.user;
    // الرتبة اللي بتظهر جنب الاسم = أعلى رتبة عند الشخص (حسب ترتيب الرتب اللي الأدمن حدده)
    const rank = actor.owner ? u.display_title || "الأدمن الأساسي" : (shownRank(c, u.rank_ids, await access.listRanks()) ?? "");
    const msg = await chat.postMessage(c.id, {
      author_id: u.id,
      code: u.military_code,
      character: u.character_name || (actor.owner ? u.display_title || "الأدمن الأساسي" : u.account_name),
      rank: actor.owner && !u.character_name ? "" : rank,
      text: data.text ?? "",
      images,
    });
    return { id: msg.id, seq: msg.seq };
  });

export const deleteMessageFn = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; messageId: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const c = await openChatFor(actor, data.chatId);
    const msg = await chat.getMessage(c.id, data.messageId);
    if (!msg) return {};
    if (msg.author_id !== actor.user.id) {
      access.assertCan(actor, "chats.moderate.delete_message", { chat: c.id });
      await audit.logAdmin(actor, {
        category: "chats", action: "chat.message.delete", summary: `حذف رسالة «${msg.character}» في «${c.name}»`, target: c.name,
        note: [msg.text.length > 300 ? `${msg.text.slice(0, 300)}…` : msg.text, msg.images.length ? `(+ ${msg.images.length} صورة)` : ""].filter(Boolean).join("\n"),
      });
    }
    await chat.deleteMessage(c.id, msg.id);
    return {};
  });

// ==================== لوحة التحكم ====================

export type ChatAdminRow = chat.Chat & {
  messages: number;
  can: { settings: Record<string, boolean>; anySettings: boolean; delete: boolean; clear: boolean };
};

function chatCan(actor: access.Actor, id: string): ChatAdminRow["can"] {
  const scope = { chat: id };
  const settings: Record<string, boolean> = {};
  for (const g of CHAT_FIELDS) settings[g.id] = access.can(actor, `chats.edit.${g.id}`, scope);
  return {
    settings,
    anySettings: Object.values(settings).some(Boolean),
    delete: access.can(actor, "chats.delete", scope),
    clear: access.can(actor, "chats.moderate.clear", scope),
  };
}

export const chatsAdminFn = createServerFn({ method: "GET" }).handler(async (): Promise<ChatAdminRow[]> => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["chats"]);
  const [chats, counts] = await Promise.all([chat.listChats(), chat.messageCounts()]);
  return chats
    .filter((c) => actor.owner || access.canAnyAt(actor, "chats", { chat: c.id }))
    .map((c) => ({ ...c, messages: counts[c.id] ?? 0, can: chatCan(actor, c.id) }));
});

/** مينفعش حد يدّي دردشة لرتبة مش معاه هو (غير صاحب الموقع). */
function assertCanAddRanks(actor: access.Actor, before: string[], after: string[]) {
  if (actor.owner) return;
  for (const id of after) {
    if (!before.includes(id) && !actor.user.rank_ids.includes(id)) throw new Error("مينفعش تدّي دردشة لرتبة مش معاك");
  }
}

export const saveChatFn = createServerFn({ method: "POST" })
  .validator((d: Partial<chat.Chat>) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const ranks = new Set((await access.listRanks()).map((r) => r.id));
    const rankNames = async (ids: string[]) => {
      const all = await access.listRanks();
      return ids.map((id) => all.find((r) => r.id === id)?.name ?? "(محذوفة)").join("، ") || null;
    };
    if (data.id) {
      const existing = await chat.getChat(data.id);
      if (!existing) throw new Error("الدردشة غير موجودة");
      const groups = changedGroups(CHAT_FIELDS, existing, data);
      if (groups.length === 0) return existing;
      access.assertCanGroups(actor, "chats.edit", groups, { chat: existing.id });
      const next = { ...existing } as Record<string, unknown>;
      for (const g of groups) for (const f of g.fields) if (f in data) next[f] = (data as Record<string, unknown>)[f];
      if (groups.some((g) => g.id === "ranks")) assertCanAddRanks(actor, existing.rank_ids, (next.rank_ids as string[]) ?? []);
      const saved = await chat.saveChat(next as Parameters<typeof chat.saveChat>[0], ranks);
      const changes = audit.buildChanges(groups, existing as unknown as Record<string, unknown>, next);
      for (const c of changes) {
        if (c.label === CHAT_FIELDS.find((g) => g.id === "ranks")!.label) {
          c.before = await rankNames(existing.rank_ids);
          c.after = await rankNames(saved.rank_ids);
        }
        if (c.label === CHAT_FIELDS.find((g) => g.id === "display")!.label) {
          c.before = (await rankNames(existing.rank_display_order)) ?? "الترتيب العام";
          c.after = (await rankNames(saved.rank_display_order)) ?? "الترتيب العام";
        }
      }
      await audit.logAdmin(actor, { category: "chats", action: "chat.update", summary: `عدّل الدردشة «${existing.name}»`, target: existing.name, changes });
      return saved;
    }
    access.assertCan(actor, "chats.create");
    assertCanAddRanks(actor, [], data.rank_ids ?? []);
    const created = await chat.saveChat(data as Parameters<typeof chat.saveChat>[0], ranks);
    if (!actor.owner) await auth.addGrants(actor.user.id, [wildcardKey("chat", created.id)]); // اللي عمل الدردشة يديرها
    await audit.logAdmin(actor, { category: "chats", action: "chat.create", summary: `أنشأ دردشة «${created.name}»`, target: created.name, note: `الرتب: ${(await rankNames(created.rank_ids)) ?? "بدون رتب"}` });
    return created;
  });

export const deleteChatFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const existing = await chat.getChat(id);
    if (!existing) return {};
    access.assertCan(actor, "chats.delete", { chat: id });
    const count = (await chat.messageCounts())[id] ?? 0;
    await chat.deleteChat(id);
    await audit.logAdmin(actor, { category: "chats", action: "chat.delete", summary: `حذف الدردشة «${existing.name}»`, target: existing.name, note: count ? `اتحذف معاها ${count} رسالة` : null });
    return {};
  });

export const clearChatFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    const existing = await chat.getChat(id);
    if (!existing) throw new Error("الدردشة غير موجودة");
    access.assertCan(actor, "chats.moderate.clear", { chat: id });
    const n = await chat.clearMessages(id);
    await audit.logAdmin(actor, { category: "chats", action: "chat.clear", summary: `مسح كل رسايل «${existing.name}»`, target: existing.name, note: `${n} رسالة` });
    return { cleared: n };
  });

/** الرتب اللي ينفع تتربط بدردشة. mine = معاك أنت (غير صاحب الموقع مينفعش يضيف غير رتبه). */
export const chatRankOptionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["chats"]);
  return (await access.listRanks()).map((r) => ({ id: r.id, name: r.name, mine: actor.owner || actor.user.rank_ids.includes(r.id) }));
});
