// اختيار "مين يدخل من غير كلمة السر": رتب كاملة و/أو أشخاص بالاسم. اللي بيتختار مبتظهرلوش خانة كلمة السر أصلًا.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, X } from "lucide-react";
import { bypassOptionsFn } from "@/lib/server-fns";
import type { Bypass } from "@/lib/bypass";

export function BypassPicker({ value, onChange, disabled }: { value: Bypass | null | undefined; onChange: (b: Bypass | null) => void; disabled?: boolean }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["bypass-options"], queryFn: () => bypassOptionsFn(), staleTime: 30_000 });
  const [q, setQ] = useState("");
  const cur: Bypass = { user_ids: value?.user_ids ?? [], rank_ids: value?.rank_ids ?? [] };

  const set = (next: Bypass) => onChange(next.user_ids.length || next.rank_ids.length ? next : null);
  const toggleRank = (id: string) => set({ ...cur, rank_ids: cur.rank_ids.includes(id) ? cur.rank_ids.filter((x) => x !== id) : [...cur.rank_ids, id] });
  const addUser = (id: string) => { set({ ...cur, user_ids: [...new Set([...cur.user_ids, id])] }); setQ(""); };
  const removeUser = (id: string) => set({ ...cur, user_ids: cur.user_ids.filter((x) => x !== id) });

  const userById = useMemo(() => new Map((data?.users ?? []).map((u) => [u.id, u])), [data]);
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return (data?.users ?? []).filter((u) => !cur.user_ids.includes(u.id) && (u.name.toLowerCase().includes(t) || u.code.toLowerCase().includes(t))).slice(0, 6);
  }, [q, data, cur.user_ids]);

  if (isError) return <div className="text-xs text-muted-foreground">مقدرتش أحمّل قايمة الرتب والأشخاص.</div>;

  return (
    <div className={`rounded-lg border border-border p-3 space-y-3 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-2 text-sm font-bold"><KeyRound className="h-4 w-4 text-[var(--gold)]" />يدخلوا من غير كلمة سر (وخانة الباسوورد متظهرلهمش)</div>
      {isLoading && <div className="text-xs text-muted-foreground">جارٍ التحميل...</div>}

      <div>
        <div className="text-xs text-muted-foreground mb-1.5">رتب</div>
        <div className="flex flex-wrap gap-1.5">
          {(data?.ranks ?? []).length === 0 && !isLoading && <span className="text-xs text-muted-foreground">مفيش رتب.</span>}
          {(data?.ranks ?? []).map((r) => {
            const on = cur.rank_ids.includes(r.id);
            return (
              <button key={r.id} type="button" onClick={() => toggleRank(r.id)} className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-[var(--gold)] bg-[var(--gold)]/20 text-[var(--gold)] font-bold" : "border-border text-muted-foreground hover:border-[var(--gold)]"}`}>
                {on ? "✓ " : ""}{r.name}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1.5">أشخاص (حسابات)</div>
        {cur.user_ids.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {cur.user_ids.map((id) => {
              const u = userById.get(id);
              return (
                <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)] bg-[var(--gold)]/15 px-2.5 py-1 text-xs text-[var(--gold)]">
                  {u ? u.name : "حساب محذوف"}{u?.code ? ` [${u.code}]` : ""}
                  <button type="button" onClick={() => removeUser(id)} title="شيل" className="hover:text-destructive"><X className="h-3 w-3" /></button>
                </span>
              );
            })}
          </div>
        )}
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الكود العسكري لإضافة شخص..." />
        {results.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-lg border border-border bg-card">
            {results.map((u) => (
              <button key={u.id} type="button" onClick={() => addUser(u.id)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-[var(--gold)]/10">
                <span className="font-bold">{u.name}</span>{u.code && <span className="text-xs text-muted-foreground">[{u.code}]</span>}
              </button>
            ))}
          </div>
        )}
        {q.trim() && results.length === 0 && !isLoading && <div className="mt-1 text-xs text-muted-foreground">مفيش نتايج.</div>}
      </div>
    </div>
  );
}
