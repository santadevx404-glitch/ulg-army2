// المتصلين دلوقتي (فوق شمال): صور الحسابات + اسم الحساب + الرتبة + الصفحة اللي هم فيها.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Users } from "lucide-react";
import { presenceFn } from "@/lib/account-fns";
import { useMe } from "@/lib/use-me";
import { Avatar } from "@/components/Avatar";

export function OnlineUsers() {
  const { me } = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const { data: users = [], refetch } = useQuery({
    queryKey: ["presence"],
    queryFn: () => presenceFn({ data: { path } }),
    enabled: !!me,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  // أول ما الصفحة تتغير نبلّغ بمكانك الجديد
  useEffect(() => { if (me) void refetch(); }, [path, me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!me || users.length === 0) return null;
  const shown = users.slice(0, 4);
  const extra = users.length - shown.length;

  return (
    <div ref={box} className="fixed top-3 left-3 z-[35]" dir="rtl">
      <button
        type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border bg-background/85 backdrop-blur px-2 py-1.5 shadow-lg hover:border-[var(--gold)] transition"
        title="المتصلين دلوقتي" aria-label="المتصلين دلوقتي"
      >
        <span className="flex -space-x-2 space-x-reverse">
          {shown.map((u) => (
            <span key={u.id} className="rounded-full ring-2 ring-background"><Avatar name={u.account_name} src={u.avatar} size={30} owner={u.is_owner} /></span>
          ))}
        </span>
        {extra > 0 && <span className="text-xs font-bold text-muted-foreground">+{extra}</span>}
        <span className="inline-flex items-center gap-1 text-xs font-bold pr-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />{users.length}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute top-full left-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-background/95 backdrop-blur shadow-2xl p-2"
          >
            <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold">
              <Users className="h-4 w-4 text-[var(--gold)]" />المتصلون الآن ({users.length})
            </div>
            <div className="space-y-1">
              {users.map((u) => (
                <div key={u.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
                  <span className="relative shrink-0">
                    <Avatar name={u.account_name} src={u.avatar} size={40} owner={u.is_owner} />
                    <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm truncate">
                      {u.account_name}{u.me && <span className="mr-1 text-[10px] font-normal text-emerald-500">(أنت)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{u.character_name}{u.military_code ? ` • ${u.military_code}` : ""}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {u.rank_names.length > 0
                        ? u.rank_names.map((r) => <span key={r} className="rounded-full bg-[var(--gold)]/15 text-[var(--gold)] px-2 py-0.5 text-[10px] font-bold">{r}</span>)
                        : <span className="rounded-full bg-white/10 text-muted-foreground px-2 py-0.5 text-[10px]">من غير رتبة</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{u.page}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
