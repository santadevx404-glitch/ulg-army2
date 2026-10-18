// كارت الإعلان: العنوان بس هو اللي ظاهر فوق، وسهم لما تدوس عليه بينزل باقي الإعلان (الصورة والنص والرابط).
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, Megaphone, X } from "lucide-react";
import { activeAnnouncementsFn } from "@/lib/announcement-fns";
import { useMe } from "@/lib/use-me";

type Tone = "info" | "success" | "warning" | "danger";

export type AnnouncementView = {
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

const TONES: Record<Tone, { box: string; accent: string; btn: string }> = {
  info: { box: "border-[var(--gold)]/50 bg-[var(--gold)]/10", accent: "text-[var(--gold)]", btn: "border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)]/10" },
  success: { box: "border-emerald-500/50 bg-emerald-500/10", accent: "text-emerald-400", btn: "border-emerald-500 text-emerald-400 hover:bg-emerald-500/10" },
  warning: { box: "border-amber-500/50 bg-amber-500/10", accent: "text-amber-400", btn: "border-amber-500 text-amber-400 hover:bg-amber-500/10" },
  danger: { box: "border-red-500/50 bg-red-500/10", accent: "text-red-400", btn: "border-red-500 text-red-400 hover:bg-red-500/10" },
};

export function AnnouncementCard({ a, onDismiss }: { a: AnnouncementView; onDismiss?: () => void }) {
  const [open, setOpen] = useState(a.open_by_default);
  const t = TONES[a.tone] ?? TONES.info;
  const hasMore = !!a.body || !!a.link_url || !!a.image; // أي حاجة غير العنوان بتنزل مع السهم

  const header = (
    <>
      <div className="flex items-center gap-3 p-3 pr-4">
        <Megaphone className={`h-5 w-5 shrink-0 ${t.accent}`} />
        <span className="flex-1 font-bold text-right" dir="auto">{a.title}</span>
        {hasMore && (
          <motion.span animate={{ rotate: open ? 180 : 0 }} className={`shrink-0 ${t.accent}`} title={open ? "إخفاء" : "عرض التفاصيل"}>
            <ChevronDown className="h-5 w-5" />
          </motion.span>
        )}
      </div>
    </>
  );

  return (
    <div className={`relative rounded-xl border overflow-hidden backdrop-blur ${t.box}`}>
      {hasMore ? (
        <button type="button" onClick={() => setOpen(!open)} className="block w-full text-right" aria-expanded={open}>{header}</button>
      ) : (
        <div>{header}</div>
      )}
      <AnimatePresence initial={false}>
        {open && hasMore && (
          <motion.div
            key="more"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-3">
              {a.image && <img src={`/api/announcement-image/${a.image}`} alt="" draggable={false} className="block w-full max-h-80 rounded-lg object-cover" />}
              {a.body && <div className="whitespace-pre-wrap break-words text-sm leading-relaxed" dir="auto">{a.body}</div>}
              {a.link_url && (
                <a
                  href={a.link_url}
                  {...(a.link_url.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition ${t.btn}`}
                >
                  {a.link_label || "المزيد"}<ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {onDismiss && a.dismissible && (
        <button type="button" onClick={onDismiss} title="إغلاق الإعلان" className="absolute top-2 left-2 z-10 h-7 w-7 rounded-full bg-black/55 text-white hover:bg-destructive flex items-center justify-center"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

const closedKey = (a: AnnouncementView) => `ann-closed:${a.id}:${a.updated_at}`;

/** الإعلانات اللي بتظهر فوق كل صفحة (حسب الأماكن اللي الأدمن حددها). لو الإعلان اتعدّل بيرجع يظهر تاني لمن قفله. */
export function AnnouncementBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { me } = useMe();
  const { data = [] } = useQuery({
    queryKey: ["announcements", pathname, me?.id ?? "anon"],
    queryFn: () => activeAnnouncementsFn({ data: { path: pathname } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const s = new Set<string>();
    for (const a of data) {
      try { if (localStorage.getItem(closedKey(a)) === "1") s.add(closedKey(a)); } catch { /* ignore */ }
    }
    setClosed(s);
  }, [data]);

  const visible = data.filter((a) => !closed.has(closedKey(a)));
  if (visible.length === 0) return null;

  return (
    <div className="px-4 lg:px-6 pt-16 lg:pt-4 space-y-3">
      {visible.map((a) => (
        <AnnouncementCard
          key={`${a.id}:${a.updated_at}`}
          a={a}
          onDismiss={() => {
            try { localStorage.setItem(closedKey(a), "1"); } catch { /* ignore */ }
            setClosed((prev) => new Set(prev).add(closedKey(a)));
          }}
        />
      ))}
    </div>
  );
}
