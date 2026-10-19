import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eraser, Eye, EyeOff, ImagePlus, Loader2, Lock, Reply, Send, Trash2, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { chatMessagesFn, chatMembersFn, sendMessageFn, deleteMessageFn, clearChatFn, setImagePrivateFn, type ChatMessageRow, type ChatMember, type Mention } from "@/lib/chat-fns";
import { useMe } from "@/lib/use-me";
import { Avatar } from "@/components/Avatar";
import { ImageLightbox, type LightboxItem } from "@/components/ImageLightbox";
import { PrivateImage } from "@/components/PrivateImage";
import { prepareImage } from "@/lib/image-utils";

export const Route = createFileRoute("/chat/$id")({
  head: () => ({ meta: [{ title: "دردشة — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: ChatRoom,
});

const MAX = 2000;
const MAX_IMAGES = 4;
const IMG_MAX_BYTES = 4 * 1024 * 1024;

type Room = { id: string; name: string; description: string; rank_names: string[]; allow_images: boolean };
type Pending = { name: string; preview: string; private: boolean };

const TMP = "tmp-"; // ids الرسايل اللي لسه بتتبعت (بتظهر فورًا)
const SEND_GAP_MS = 350; // أقل فاصل بين رسالتين من نفس الشخص (يتوافق مع حماية السيرفر)

const POLL_VISIBLE_MS = 1500; // كل 1.5 ثانية والتاب ظاهر (وأبطأ لو مخفي)
const POLL_HIDDEN_MS = 10000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** بيظبّط شكل @المنشن جوه نص الرسالة (بالذهبي)، ولو المنشن ليا بيبان أوضح. */
function renderWithMentions(text: string, mentions: Mention[], meId: string) {
  if (!mentions.length) return text;
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`(${names.map((n) => "@" + escapeRe(n.name)).join("|")})`, "g");
  return text.split(re).map((part, i) => {
    const hit = names.find((n) => part === "@" + n.name);
    if (!hit) return part;
    return <span key={i} className={`rounded px-1 font-bold text-[var(--gold)] ${hit.id === meId ? "bg-[var(--gold)]/25" : "bg-[var(--gold)]/10"}`}>{part}</span>;
  });
}

function ChatRoom() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { me, loading } = useMe();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [denied, setDenied] = useState("");
  const [canClear, setCanClear] = useState(false);
  const [text, setText] = useState("");
  const lastSeq = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [imgError, setImgError] = useState("");
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const justSent = useRef(new Set<string>()); // رسايلي اللي لسه ظاهرة محليًا ومستنية polling يشوفها
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // الرد والمنشن
  const [replyTo, setReplyTo] = useState<ChatMessageRow | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const picked = useRef(new Map<string, string>()); // id -> اسم (اللي اخترتهم من القايمة)
  const [flashId, setFlashId] = useState<string | null>(null);
  const meIdRef = useRef<string | undefined>(undefined);
  meIdRef.current = me?.id;

  // أعضاء الدردشة (للمنشن)
  useEffect(() => {
    if (!me) return;
    let dead = false;
    setReplyTo(null); picked.current.clear(); setMention(null);
    const load = () => chatMembersFn({ data: { chatId: id } }).then((r) => { if (!dead) setMembers(r); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, [me, id]);

  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);

  const polling = useRef(false);
  const activeId = useRef(id);
  activeId.current = id;
  const poll = useCallback(async () => {
    if (polling.current) return; // طلب واحد في الوقت (مفيش تراكم لو السيرفر بطيء)
    polling.current = true;
    const firstLoad = lastSeq.current === undefined;
    try {
      const r = await chatMessagesFn({ data: { chatId: id, after: lastSeq.current } });
      if (activeId.current !== id) return; // اتنقلنا لدردشة تانية أثناء الطلب
      // تنبيه لما حد يعملك منشن أو يرد على رسالتك (مش في أول تحميل للدردشة)
      if (!firstLoad) {
        for (const f of r.messages) {
          if (!f.mentioned_me) continue;
          const byMention = f.mentions.some((x) => x.id === meIdRef.current);
          toast(`${f.character} ${byMention ? "ذكرك في رسالة" : "رد على رسالتك"}`, { description: f.text.slice(0, 80) || (f.images.length ? "📷 صورة" : undefined) });
        }
      }
      setRoom(r.chat);
      setCanClear(r.can_clear);
      const live = new Set(r.live_ids);
      for (const mid of live) justSent.current.delete(mid); // السيرفر شافها خلاص
      setMessages((prev) => {
        // الرسايل الجديدة بس هي اللي بتتضاف، والمتمسوحة بتتشال (ورسايلي اللي لسه مبعوتة من لحظة بتفضل)
        let kept = prev.filter((m) => live.has(m.id) || justSent.current.has(m.id) || m.id.startsWith(TMP));
        const fresh = r.messages.filter((m) => !kept.some((p) => p.id === m.id));
        // لو رسالتي الحقيقية وصلت قبل ما رد الإرسال يرجع، نشيل نسختها المؤقتة عشان متتكررش
        for (const f of fresh) {
          if (!f.mine) continue;
          const key = f.text + "|" + f.images.join(",");
          const i = kept.findIndex((k) => k.id.startsWith(TMP) && k.text + "|" + k.images.join(",") === key);
          if (i >= 0) kept = kept.filter((_, j) => j !== i);
        }
        const merged = [...kept, ...fresh].map((m) => (m.images.length ? { ...m, private_images: r.private_map[m.id] ?? (live.has(m.id) ? [] : m.private_images) } : m));
        const maxSeq = r.messages.reduce((a, m) => Math.max(a, m.seq), lastSeq.current ?? 0);
        lastSeq.current = Math.max(maxSeq, lastSeq.current ?? 0);
        return merged.sort((a, b) => a.seq - b.seq);
      });
      setDenied("");
    } catch (e: any) {
      const m = String(e?.message || "");
      if (m.includes("مقفولة") || m.includes("غير موجودة")) setDenied(m);
    } finally { polling.current = false; }
  }, [id]);

  // تحديث كل 1.5 ثانية (وأبطأ لو التاب مش ظاهر) + تحديث فوري أول ما ترجع للتاب
  useEffect(() => {
    if (!me) return;
    lastSeq.current = undefined;
    polling.current = false;
    justSent.current.clear();
    setMessages([]);
    poll();
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => { if (stop) return; await poll(); loop(); }, document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
    };
    loop();
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [me, id, poll]);

  // نزّل لآخر رسالة لو الشخص قريب من الآخر
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // رفع صور (من الزرار أو اللصق أو السحب). كل صورة بتتضغط وبتترفع فورًا وبتستنى الإرسال.
  const attach = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    setImgError("");
    const room = Math.max(0, MAX_IMAGES - pending.length);
    if (imgs.length > room) setImgError(`أقصى عدد صور في الرسالة ${MAX_IMAGES}`);
    for (const f of imgs.slice(0, room)) {
      setUploading((n) => n + 1);
      try {
        const blob = await prepareImage(f, { maxBytes: IMG_MAX_BYTES, maxSide: 1800 });
        const r = await fetch(`/api/chat-image?chatId=${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "فشل رفع الصورة");
        setPending((p) => [...p, { name: j.name, preview: URL.createObjectURL(blob), private: false }]);
      } catch (e: any) {
        setImgError(e.message || "فشل رفع الصورة");
      } finally { setUploading((n) => n - 1); }
    }
  };

  const dropPending = async (p: Pending) => {
    setPending((list) => list.filter((x) => x.name !== p.name));
    URL.revokeObjectURL(p.preview);
    fetch(`/api/chat-image?name=${encodeURIComponent(p.name)}`, { method: "DELETE" }).catch(() => {});
  };

  // ===== الإرسال الفوري =====
  // الرسالة بتظهر في نفس اللحظة اللي تدوس فيها إرسال والخانة بتفضى، والرفع للسيرفر بيحصل في الخلفية
  // (في طابور بيحافظ على الترتيب). لو فشل، الرسالة بتتشال والنص بيرجع لك عشان متضيعش.
  const sendQueue = useRef<Promise<void>>(Promise.resolve());
  const lastSendAt = useRef(0);
  const tmpCounter = useRef(0);

  const send = () => {
    const t = text.trim();
    if ((!t && pending.length === 0) || uploading > 0 || !me) return;
    const imgs = pending;
    const tmpId = `${TMP}${Date.now()}-${tmpCounter.current++}`;
    const mentionList: Mention[] = [...picked.current].filter(([, name]) => t.includes(`@${name}`)).map(([mid, name]) => ({ id: mid, name }));
    const replyId = replyTo && !replyTo.id.startsWith(TMP) ? replyTo.id : undefined;
    const myRank = [...messages].reverse().find((m) => m.mine)?.rank ?? (me.owner ? me.display_title || "الأدمن الأساسي" : me.rank_names[0] ?? "");
    const optimistic: ChatMessageRow = {
      id: tmpId,
      seq: 1e12 + tmpCounter.current, // دايمًا في الآخر لحد ما السيرفر يدّيها رقمها الحقيقي
      author_id: me.id,
      code: me.military_code ?? "",
      character: me.character_name || (me.owner ? me.display_title || "الأدمن الأساسي" : me.account_name),
      rank: me.owner && !me.character_name ? "" : myRank,
      avatar: me.avatar ?? null,
      text: t,
      at: new Date().toISOString(),
      images: imgs.map((p) => p.name),
      private_images: imgs.filter((p) => p.private).map((p) => p.name),
      reply_to: replyTo ? { id: replyTo.id, author_id: replyTo.author_id, character: replyTo.character, text: replyTo.text.replace(/\s+/g, " ").slice(0, 140), has_image: replyTo.images.length > 0 } : null,
      mentions: mentionList,
      mentioned_me: false,
      mine: true,
      can_delete: false,
    };
    // فورًا: الرسالة تظهر + الخانة تفضى
    setMessages((prev) => [...prev, optimistic]);
    setPending([]);
    setImgError("");
    setText("");
    setReplyTo(null);
    setMention(null);
    picked.current.clear();
    stickToBottom.current = true;

    sendQueue.current = sendQueue.current.then(async () => {
      const wait = SEND_GAP_MS - (Date.now() - lastSendAt.current);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSendAt.current = Date.now();
      try {
        const msg = await sendMessageFn({ data: { chatId: id, text: t, images: imgs.map((p) => p.name), privateImages: imgs.filter((p) => p.private).map((p) => p.name), replyTo: replyId, mentions: mentionList.map((x) => x.id) } });
        imgs.forEach((p) => URL.revokeObjectURL(p.preview));
        justSent.current.add(msg.id);
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== tmpId);
          return (without.some((m) => m.id === msg.id) ? without : [...without, msg]).sort((a, b) => a.seq - b.seq);
        });
        void poll();
      } catch (e: any) {
        // فشل: نشيل الرسالة المؤقتة ونرجّع النص والصور عشان يعيد الإرسال
        setMessages((prev) => prev.filter((m) => m.id !== tmpId));
        setText((cur) => (cur ? cur : t));
        setPending((cur) => (cur.length ? cur : imgs));
        toast.error(e.message || "فشل الإرسال");
      }
    });
  };

  const startReply = (m: ChatMessageRow) => {
    setReplyTo(m);
    taRef.current?.focus();
  };

  // الضغط على الاقتباس بيودّيك للرسالة الأصلية ويظلّلها لحظة
  const jumpTo = (mid: string) => {
    const el = document.getElementById(`msg-${mid}`);
    if (!el) { toast("الرسالة الأصلية قديمة أو اتمسحت"); return; }
    stickToBottom.current = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(mid);
    setTimeout(() => setFlashId((cur) => (cur === mid ? null : cur)), 1600);
  };

  // المنشن: لما تكتب @ وراها حروف بتظهر قايمة الأعضاء
  const detectMention = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]{0,24})$/.exec(value.slice(0, caret));
    if (m) { setMention({ start: caret - m[2].length - 1, query: m[2] }); setMentionIdx(0); } else setMention(null);
  };
  const mentionMatches = mention
    ? members.filter((x) => x.id !== me?.id && (x.name.toLowerCase().includes(mention.query.toLowerCase()) || x.code.includes(mention.query))).slice(0, 6)
    : [];
  const pickMention = (mb: ChatMember) => {
    const ta = taRef.current;
    if (!mention || !ta) return;
    const caret = ta.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + `@${mb.name} ` + text.slice(caret);
    const pos = mention.start + mb.name.length + 2;
    picked.current.set(mb.id, mb.name);
    setText(next.slice(0, MAX));
    setMention(null);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  };

  const togglePrivate = async (m: ChatMessageRow, name: string) => {
    const makePrivate = !m.private_images.includes(name);
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, private_images: makePrivate ? [...x.private_images, name] : x.private_images.filter((n) => n !== name) } : x)));
    try {
      const r = await setImagePrivateFn({ data: { chatId: id, messageId: m.id, name, value: makePrivate } });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, private_images: r.private_images } : x)));
    } catch (e: any) {
      toast.error(e.message || "حدث خطأ");
      poll();
    }
  };

  const remove = async (m: ChatMessageRow) => {
    try {
      await deleteMessageFn({ data: { chatId: id, messageId: m.id } });
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); }
  };

  const clear = async () => {
    if (!confirm("مسح كل رسايل الدردشة دي؟")) return;
    try { await clearChatFn({ data: id }); setMessages([]); } catch (e: any) { toast.error(e.message || "حدث خطأ"); }
  };

  if (loading || !me) return <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>;

  if (denied) return (
    <div className="p-16 text-center max-w-md mx-auto">
      <Lock className="h-12 w-12 mx-auto text-[var(--gold)] mb-4" />
      <h1 className="text-xl font-bold mb-2">{denied}</h1>
      <Link to="/chat" className="btn-gold ripple inline-block mt-4">كل الدردشات</Link>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col" style={{ height: "calc(100dvh - 2rem)" }}>
      <div className="flex items-center gap-3 mb-4">
        <Link to="/chat" className="p-2 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-[var(--gold)]" title="كل الدردشات"><ArrowRight className="h-5 w-5" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black gold-text truncate">{room?.name ?? "..."}</h1>
          {room && room.rank_names.length > 0 && <div className="text-xs text-muted-foreground">للرتب: {room.rank_names.join("، ")}</div>}
        </div>
        {canClear && <button onClick={clear} title="مسح كل الرسايل" className="p-2 text-muted-foreground hover:text-destructive"><Eraser className="h-5 w-5" /></button>}
      </div>

      <div ref={listRef} onScroll={onScroll} className="chat-scroll flex-1 min-h-0 rounded-xl border border-border bg-card/80 backdrop-blur p-4 space-y-4">
        {messages.length === 0 && <div className="text-center text-muted-foreground py-16 text-sm">مفيش رسايل لسه. ابدأ الكلام.</div>}
        {messages.map((m) => (
          <div key={m.id} id={`msg-${m.id}`} className={`group flex gap-3 rounded-lg transition-colors duration-500 ${m.mentioned_me ? "border-r-2 border-[var(--gold)] bg-[var(--gold)]/10 -mx-2 px-2 py-1.5" : ""} ${flashId === m.id ? "!bg-[var(--gold)]/25" : ""}`}>
            <Avatar name={m.character} src={m.avatar} size={40} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap text-sm">
                {/* الشكل: [الكود] اسم الشخصية - الرتبة */}
                <span className="font-bold" dir="auto">
                  {m.code && <span className="text-muted-foreground">[{m.code}] </span>}
                  {m.character}
                  {m.rank && <span className="text-[var(--gold)]"> - {m.rank}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(m.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</span>
                {!m.id.startsWith(TMP) && (
                  <button onClick={() => startReply(m)} title="رد على الرسالة" className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition text-muted-foreground hover:text-[var(--gold)]"><Reply className="h-3.5 w-3.5" /></button>
                )}
                {m.can_delete && (
                  <button onClick={() => remove(m)} title="حذف الرسالة" className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
              {m.reply_to && (
                <button type="button" onClick={() => jumpTo(m.reply_to!.id)} title="روح للرسالة الأصلية" className="mt-1 mb-0.5 flex max-w-full items-center gap-2 rounded-md border-r-2 border-[var(--gold)] bg-[var(--gold)]/10 px-2 py-1 text-start text-xs transition hover:bg-[var(--gold)]/20">
                  <Reply className="h-3 w-3 shrink-0 text-[var(--gold)]" />
                  <span className="shrink-0 font-bold text-[var(--gold)]" dir="auto">{m.reply_to.character}</span>
                  <span className="truncate text-muted-foreground" dir="auto">{m.reply_to.text || (m.reply_to.has_image ? "📷 صورة" : "")}</span>
                </button>
              )}
              {m.text && <div className="whitespace-pre-wrap break-words mt-0.5" dir="auto">{renderWithMentions(m.text, m.mentions, me.id)}</div>}
              {m.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {m.images.map((n, i) => {
                    const isPriv = m.private_images.includes(n);
                    const url = `/api/chat-image/${n}`;
                    return (
                      <div key={n} className="relative group/img">
                        <button type="button" onClick={() => setLightbox({ items: m.images.map((x) => ({ url: `/api/chat-image/${x}`, private: m.private_images.includes(x) })), index: i })} title="تكبير الصورة" className="block rounded-lg overflow-hidden border border-border hover:border-[var(--gold)] transition">
                          {isPriv
                            ? <PrivateImage src={url} className="block max-h-56 max-w-[min(100%,18rem)] object-cover cursor-zoom-in" />
                            : <img src={url} alt="" loading="lazy" draggable={false} className="block max-h-56 max-w-[min(100%,18rem)] object-cover cursor-zoom-in" />}
                        </button>
                        <div className="absolute top-1.5 left-1.5 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 focus-within:opacity-100 transition">
                          {!isPriv && (
                            <a href={`${url}?download=1`} download title="تحميل الصورة" onClick={(e) => e.stopPropagation()} className="h-7 w-7 rounded-md bg-black/60 text-white hover:text-[var(--gold)] flex items-center justify-center"><Download className="h-4 w-4" /></a>
                          )}
                          {m.mine && !m.id.startsWith(TMP) && (
                            <button type="button" onClick={() => togglePrivate(m, n)} title={isPriv ? "خلّي الصورة عادية (يظهر زرار التحميل)" : "خلّي الصورة برايفت (من غير تحميل)"} className="h-7 w-7 rounded-md bg-black/60 text-white hover:text-[var(--gold)] flex items-center justify-center">
                              {isPriv ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                        {isPriv && <span className="pointer-events-none absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80"><EyeOff className="h-3 w-3" />برايفت</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {(pending.length > 0 || uploading > 0 || imgError) && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            {pending.map((p) => (
              <div key={p.name} className="relative">
                <img src={p.preview} alt="" className="h-20 w-20 rounded-lg object-cover border border-border" />
                <button type="button" onClick={() => setPending((list) => list.map((x) => (x.name === p.name ? { ...x, private: !x.private } : x)))} title={p.private ? "برايفت: من غير تحميل (دوس عشان تخليها عادية)" : "خلّي الصورة برايفت (من غير تحميل)"} className={`absolute bottom-1 left-1 h-6 px-1.5 rounded-md text-[11px] flex items-center gap-1 ${p.private ? "bg-[var(--gold)] text-black" : "bg-black/60 text-white"}`}>
                  {p.private ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{p.private ? "برايفت" : "عادية"}
                </button>
                <button type="button" onClick={() => dropPending(p)} title="شيل الصورة" className="absolute -top-2 -left-2 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center"><X className="h-3 w-3" /></button>
              </div>
            ))}
            {uploading > 0 && <div className="h-20 w-20 rounded-lg border border-dashed border-border flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-[var(--gold)]" /></div>}
          </div>
          {imgError && <div className="text-sm text-destructive mt-1">{imgError}</div>}
        </div>
      )}

      {replyTo && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border border-r-2 border-r-[var(--gold)] bg-[var(--gold)]/10 px-3 py-2">
          <Reply className="h-4 w-4 shrink-0 text-[var(--gold)]" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-[var(--gold)]" dir="auto">رد على {replyTo.character}</div>
            <div className="truncate text-xs text-muted-foreground" dir="auto">{replyTo.text || (replyTo.images.length ? "📷 صورة" : "")}</div>
          </div>
          <button type="button" onClick={() => setReplyTo(null)} title="إلغاء الرد" className="p-1 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="mt-3 flex gap-2 items-end" onDragOver={(e) => { if (room?.allow_images) e.preventDefault(); }} onDrop={(e) => { if (room?.allow_images && e.dataTransfer.files.length) { e.preventDefault(); attach(Array.from(e.dataTransfer.files)); } }}>
        {room?.allow_images && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={pending.length >= MAX_IMAGES} title="إرفاق صورة" className="h-11 w-11 shrink-0 rounded-lg border border-border hover:border-[var(--gold)] hover:text-[var(--gold)] flex items-center justify-center disabled:opacity-40"><ImagePlus className="h-5 w-5" /></button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={(e) => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </>
        )}
        <div className="relative flex-1">
        {mention && mentionMatches.length > 0 && (
          <div className="absolute bottom-full right-0 left-0 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border">منشن — اختار شخص</div>
            {mentionMatches.map((mb, i) => (
              <button key={mb.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(mb); }} onMouseEnter={() => setMentionIdx(i)} className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm ${i === mentionIdx ? "bg-[var(--gold)]/15" : ""}`}>
                <Avatar name={mb.name} src={mb.avatar} size={26} />
                <span className="font-bold truncate" dir="auto">{mb.name}</span>
                {mb.code && <span className="text-xs text-muted-foreground">[{mb.code}]</span>}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          className="input w-full resize-none"
          rows={2}
          maxLength={MAX}
          placeholder={room?.allow_images ? "اكتب رسالتك أو الصق صورة... (@ لمنشن شخص، Enter للإرسال)" : "اكتب رسالتك... (@ لمنشن شخص، Enter للإرسال، Shift+Enter سطر جديد)"}
          value={text}
          onChange={(e) => { setText(e.target.value); detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onClick={(e) => detectMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onPaste={(e) => {
            if (!room?.allow_images) return;
            const files = Array.from(e.clipboardData.items).filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
            if (files.length) { e.preventDefault(); attach(files); }
          }}
          onKeyDown={(e) => {
            if (mention && mentionMatches.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionMatches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(mentionMatches[Math.min(mentionIdx, mentionMatches.length - 1)]); return; }
              if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
            }
            if (e.key === "Escape" && replyTo) { setReplyTo(null); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
        />
        </div>
        <button onClick={send} disabled={uploading > 0 || (!text.trim() && pending.length === 0)} className="btn-gold ripple h-11 px-4 inline-flex items-center gap-2 disabled:opacity-40"><Send className="h-4 w-4" />إرسال</button>
      </div>

      {lightbox && <ImageLightbox items={lightbox.items} index={lightbox.index} onIndex={(i) => setLightbox({ ...lightbox, index: i })} onClose={() => setLightbox(null)} />}
    </div>
  );
}
