// "رتبي": الشخص يضيف/يشيل لنفسه الرتب اللي تحت أعلى رتبة عنده (صلاحية: منح الرتب الأدنى إلى حسابه).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserCog } from "lucide-react";
import { ranksListFn, setSelfRanksFn } from "@/lib/account-fns";
import { covers } from "@/lib/permissions";
import { useMe } from "@/lib/use-me";

export function SelfRanksPanel() {
  const qc = useQueryClient();
  const { me, can } = useMe();
  const enabled = !!me && can("ranks.below.self");
  const { data: ranks = [] } = useQuery({ queryKey: ["admin-ranks"], queryFn: () => ranksListFn(), enabled });
  if (!enabled || !me) return null;

  const top = me.top_rank_order;
  const mine = me.rank_ids;
  const below = ranks.filter((r) => top !== null && r.order > top);
  const toggle = async (id: string) => {
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    try { await setSelfRanksFn({ data: { rank_ids: next } }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success(mine.includes(id) ? "تمت إزالة الرتبة من حسابك" : "تمت إضافة الرتبة إلى حسابك");
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["admin-ranks"] });
  };

  return (
    <div className="mil-card p-6">
      <h2 className="font-bold mb-1 flex items-center gap-2"><UserCog className="h-5 w-5 text-[var(--gold)]" />رتبي</h2>
      <p className="text-xs text-muted-foreground mb-4 leading-loose">
        يمكنك إضافة أو إزالة الرتب الأدنى من أعلى رتبة تشغلها، ضمن حدود صلاحياتك. رتبتك الحالية: <b className="text-foreground">{me.rank_names.join("، ") || "—"}</b>
      </p>
      {top === null ? (
        <div className="text-sm text-muted-foreground">لا توجد رتبة مسندة إلى حسابك، لذلك لا توجد رتب أدنى منها.</div>
      ) : below.length === 0 ? (
        <div className="text-sm text-muted-foreground">لا توجد رتب أدنى من رتبتك حاليًا.</div>
      ) : (
        <div className="grid gap-2">
          {below.map((r) => {
            const has = mine.includes(r.id);
            const blocked = !has && !r.permissions.every((k) => covers(me.perms, me.full, k));
            return (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.permissions.length} صلاحية{blocked ? " — تتجاوز صلاحياتك الحالية" : ""}</div>
                </div>
                <button
                  type="button" disabled={blocked} onClick={() => toggle(r.id)}
                  className={`px-3 py-1.5 rounded-full border text-xs transition disabled:opacity-40 disabled:cursor-not-allowed ${has ? "border-destructive/60 text-destructive hover:bg-destructive/10" : "border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)]/10"}`}
                >{has ? "إزالة" : "إضافة"}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
