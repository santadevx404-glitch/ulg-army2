// "رتبي": قائمة منسدلة يختار منها الشخص الرتب الأدنى من أعلى رتبة عنده ويحفظها على حسابه.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Save, UserCog, X } from "lucide-react";
import { ranksListFn, setSelfRanksFn } from "@/lib/account-fns";
import { useMe } from "@/lib/use-me";

export function SelfRanksPanel() {
  const qc = useQueryClient();
  const { me, can } = useMe();
  const isOwner = !!me?.owner;
  const enabled = !!me && (isOwner || can("ranks.below.self"));
  const { data: ranks = [] } = useQuery({ queryKey: ["admin-ranks"], queryFn: () => ranksListFn(), enabled });
  const top = me?.top_rank_order ?? null;
  const mine = me?.rank_ids ?? [];
  const below = isOwner ? ranks : ranks.filter((r) => top !== null && r.order > top); // صاحب الموقع: كل الرتب
  const belowIds = below.map((r) => r.id);

  // الاختيار الحالي بين الرتب الأدنى بس (رتبك العليا ثابتة ومش بتتغير من هنا)
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mineKey = mine.join(",") + "|" + belowIds.join(",");
  useEffect(() => { setPicked(mine.filter((id) => belowIds.includes(id))); }, [mineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!enabled || !me) return null;

  const current = mine.filter((id) => belowIds.includes(id));
  const dirty = picked.length !== current.length || picked.some((id) => !current.includes(id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async () => {
    setSaving(true);
    try {
      const keepAbove = mine.filter((id) => !belowIds.includes(id));
      await setSelfRanksFn({ data: { rank_ids: [...keepAbove, ...picked] } });
      toast.success("تم حفظ رتبك");
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["admin-ranks"] });
    } catch (e: any) {
      toast.error(e.message || "حدث خطأ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mil-card p-6">
      <h2 className="font-bold mb-1 flex items-center gap-2"><UserCog className="h-5 w-5 text-[var(--gold)]" />رتبي</h2>
      <p className="text-xs text-muted-foreground mb-4 leading-loose">
        {isOwner ? "اختر من القائمة أي رتبة لإضافتها إلى حسابك أو إزالتها منه." : "اختر من القائمة الرتب الأدنى من أعلى رتبة تشغلها لإضافتها إلى حسابك."} رتبتك الحالية: <b className="text-foreground">{me.rank_names.join("، ") || "—"}</b>
      </p>
      {top === null && !isOwner ? (
        <div className="text-sm text-muted-foreground">لا توجد رتبة مسندة إلى حسابك، لذلك لا توجد رتب أدنى منها.</div>
      ) : below.length === 0 ? (
        <div className="text-sm text-muted-foreground">لا توجد رتب أدنى من رتبتك حاليًا.</div>
      ) : (
        <>
          <div ref={box} className="relative">
            <button
              type="button" onClick={() => setOpen((v) => !v)}
              className="input w-full flex items-center justify-between gap-2 text-right min-h-11"
            >
              <span className="flex flex-wrap gap-1.5 flex-1">
                {picked.length === 0 && <span className="text-muted-foreground">اختر الرتب...</span>}
                {picked.map((id) => {
                  const r = below.find((x) => x.id === id);
                  return r ? (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[var(--gold)]/15 text-[var(--gold)] px-2.5 py-0.5 text-xs font-bold">
                      {r.name}
                      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); toggle(id); }} className="hover:text-destructive"><X className="h-3 w-3" /></span>
                    </span>
                  ) : null;
                })}
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="mt-2 w-full min-h-72 max-h-[65vh] overflow-y-scroll drag-scroll rounded-lg border border-border bg-background shadow-2xl p-2 space-y-1">
                {below.map((r) => {
                  const on = picked.includes(r.id);
                  return (
                    <button
                      key={r.id} type="button" onClick={() => toggle(r.id)}
                      className={`w-full flex items-center gap-3 rounded-md px-3 py-3 text-sm text-right hover:bg-white/5 ${on ? "text-[var(--gold)]" : ""}`}
                    >
                      <span className={`h-5 w-5 shrink-0 rounded border flex items-center justify-center ${on ? "bg-[var(--gold)] border-[var(--gold)] text-black" : "border-border"}`}>
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex-1">{r.name}</span>
                      <span className="text-[11px] text-muted-foreground">{r.permissions.length} صلاحية</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button type="button" onClick={save} disabled={!dirty || saving} className="btn-gold ripple mt-4 inline-flex items-center gap-2 disabled:opacity-40">
            <Save className="h-4 w-4" />{saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
        </>
      )}
    </div>
  );
}
