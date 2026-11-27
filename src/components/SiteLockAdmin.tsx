// تعطيل الموقع — لصاحب الموقع بس.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PowerOff, Power, KeyRound } from "lucide-react";
import { setSiteLockFn, siteLockStatusFn } from "@/lib/account-fns";

export function SiteLockAdmin() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["site-lock"], queryFn: () => siteLockStatusFn() });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (enabled: boolean, newCode?: string, msg?: string) => {
    setBusy(true);
    try {
      await setSiteLockFn({ data: { enabled, code: newCode } });
      toast.success(msg ?? (enabled ? "الموقع اتعطّل" : "الموقع اشتغل تاني"));
      setCode("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["site-lock"] });
    } catch (e: any) { toast.error(e.message || "حدث خطأ"); } finally { setBusy(false); }
  };
  if (!data) return null;
  return (
    <div className="max-w-xl space-y-4">
      <div className={`mil-card p-5 border ${data.enabled ? "border-destructive/60" : "border-emerald-500/40"}`}>
        <div className="flex items-center gap-3">
          {data.enabled ? <PowerOff className="h-6 w-6 text-destructive" /> : <Power className="h-6 w-6 text-emerald-500" />}
          <div className="flex-1">
            <div className="font-black">{data.enabled ? "الموقع معطّل حاليًا" : "الموقع شغال"}</div>
            <div className="text-xs text-muted-foreground leading-loose">
              لما يتعطّل: كل الزوار (مهما كانت رتبهم أو تسجيلهم) بيشوفوا صفحة «Website Hes Broken» في الرئيسية وأي رابط بيحوّلهم ليها، وكل الطلبات بتتوقف. الدخول بكود المطوّر بس (على متصفحك إنت).
            </div>
          </div>
        </div>
        <button
          onClick={() => (data.enabled ? run(false) : confirm("تعطيل الموقع بالكامل لكل الناس؟ (إنت هتفضل داخل على المتصفح ده)") && run(true))}
          disabled={busy || (!data.enabled && !data.hasCode)}
          className={`mt-4 px-5 py-2 rounded-md text-white font-bold disabled:opacity-40 ${data.enabled ? "bg-emerald-600" : "bg-destructive"}`}
        >
          {data.enabled ? "تشغيل الموقع" : "تعطيل الموقع"}
        </button>
        {!data.enabled && !data.hasCode && <div className="text-xs text-amber-500 mt-2">حدّد كود المطوّر تحت الأول.</div>}
      </div>

      <div className="mil-card p-5">
        <h3 className="font-bold mb-2 flex items-center gap-2"><KeyRound className="h-4 w-4 text-[var(--gold)]" />كود المطوّر</h3>
        <p className="text-xs text-muted-foreground mb-3 leading-loose">
          الكود اللي بتكتبه في خانة «Developer Code» عشان تفتح الموقع وهو معطّل. بيتخزّن مشفّر ومبيتعرضش تاني — {data.hasCode ? "فيه كود محدد حاليًا، كتابة كود جديد بتستبدله." : "لسه ماحدّدتش كود."}
        </p>
        <div className="flex gap-2">
          <input className="input flex-1" dir="ltr" type="password" placeholder="كود جديد (4 حروف على الأقل)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="new-password" />
          <button onClick={() => run(data.enabled, code, "تم حفظ كود المطوّر")} disabled={busy || code.trim().length < 4} className="btn-gold ripple disabled:opacity-40">حفظ الكود</button>
        </div>
      </div>
    </div>
  );
}
