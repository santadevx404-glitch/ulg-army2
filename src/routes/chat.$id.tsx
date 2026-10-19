import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eraser, Eye, EyeOff, ImagePlus, Loader2, Lock, Send, Trash2, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { chatMessagesFn, sendMessageFn, deleteMessageFn, clearChatFn, setImagePrivateFn, type ChatMessageRow } from "@/lib/chat-fns";
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

const POLL_VISIBLE_MS = 1500; // كل 1.5 ثانية والتاب ظاهر (وأبطأ لو مخفي)
const POLL_HIDDEN_MS = 10000;

function ChatRoom() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { me, loading } = useMe();
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [denied, setDenied] = useState("");
  const [canClear, setCanClear] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastSeq = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [imgError, setImgError] = useState("");
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const justSent = useRef(new Set<string>()); // رسايلي اللي لسه ظاهرة محليًا ومستنية polling يشوفها
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);

  const polling = useRef(false);
  const activeId = useRef(id);
  activeId.current = id;
  const poll = useCallback(async () => {
    if (polling.current) return; // طلب واحد في الوقت (مفيش تراكم لو السيرفر بطيء)
    polling.current = true;
    try {
      const r = await chatMessagesFn({ data: { chatId: id, after: lastSeq.current } });
      if (activeId.current !== id) return; // اتنقلنا لدردشة تانية أثناء الطلب
      setRoom(r.chat);
      setCanClear(r.can_clear);
      const live = new Set(r.live_ids);
      for (const mid of live) justSent.current.delete(mid); // السيرفر شافها خلاص
      setMessages((prev) => {
        // الرسايل الجديدة بس هي اللي بتتضاف، والمتمسوحة بتتشال (ورسايلي اللي لسه مبعوتة من لحظة بتفضل)
        const kept = prev.filter((m) => live.has(m.id) || justSent.current.has(m.id));
        const fresh = r.messages.filter((m) => !kept.some((p) => p.id === m.id));
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

  const send = async () => {
    const t = text.trim();
    if ((!t && pending.length === 0) || sending || uploading > 0) return;
    setSending(true);
    try {
      const msg = await sendMessageFn({ data: { chatId: id, text: t, images: pending.map((p) => p.name), privateImages: pending.filter((p) => p.private).map((p) => p.name) } });
      pending.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending([]);
      setImgError("");
      setText("");
      stickToBottom.current = true;
      // الرسالة بتظهر فورًا عندي من غير ما أستنى polling (lastSeq مش بيتغيّر عشان محدش يفوّت رسايل غيري)
      justSent.current.add(msg.id);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].sort((a, b) => a.seq - b.seq)));
      void poll();
    } catch (e: any) {
      toast.error(e.message || "فشل الإرسال");
    } finally { setSending(false); }
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
          <div key={m.id} className="group flex gap-3">
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
                {m.can_delete && (
                  <button onClick={() => remove(m)} title="حذف الرسالة" className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
              {m.text && <div className="whitespace-pre-wrap break-words mt-0.5" dir="auto">{m.text}</div>}
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
                          {m.mine && (
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

      <div className="mt-3 flex gap-2 items-end" onDragOver={(e) => { if (room?.allow_images) e.preventDefault(); }} onDrop={(e) => { if (room?.allow_images && e.dataTransfer.files.length) { e.preventDefault(); attach(Array.from(e.dataTransfer.files)); } }}>
        {room?.allow_images && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={pending.length >= MAX_IMAGES} title="إرفاق صورة" className="h-11 w-11 shrink-0 rounded-lg border border-border hover:border-[var(--gold)] hover:text-[var(--gold)] flex items-center justify-center disabled:opacity-40"><ImagePlus className="h-5 w-5" /></button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="hidden" onChange={(e) => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </>
        )}
        <textarea
          className="input flex-1 resize-none"
          rows={2}
          maxLength={MAX}
          placeholder={room?.allow_images ? "اكتب رسالتك أو الصق صورة... (Enter للإرسال)" : "اكتب رسالتك... (Enter للإرسال، Shift+Enter سطر جديد)"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (!room?.allow_images) return;
            const files = Array.from(e.clipboardData.items).filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
            if (files.length) { e.preventDefault(); attach(files); }
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button onClick={send} disabled={sending || uploading > 0 || (!text.trim() && pending.length === 0)} className="btn-gold ripple h-11 px-4 inline-flex items-center gap-2 disabled:opacity-40"><Send className="h-4 w-4" />إرسال</button>
      </div>

      {lightbox && <ImageLightbox items={lightbox.items} index={lightbox.index} onIndex={(i) => setLightbox({ ...lightbox, index: i })} onClose={() => setLightbox(null)} />}
    </div>
  );
}
