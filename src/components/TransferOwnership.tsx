// نقل ملكية الموقع لحساب تاني (للمالك الحالي بس).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crown } from "lucide-react";
import { ownerCandidatesFn, transferOwnershipFn } from "@/lib/account-fns";

export function TransferOwnership() {
  const qc = useQueryClient();
  const { data: list = [] } = useQuery({ queryKey: ["owner-candidates"], queryFn: () => ownerCandidatesFn() });
  const [to, setTo] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const target = list.find((u) => u.id === to);

  const go = async () => {
    if (!target) return;
    if (!confirm(`هتنقل ملكية الموقع إلى «${target.name}». هتبقى بعدها حساب عادي بصلاحيات رتبك بس. متأكد؟`)) return;
    setBusy(true);
    try {
      await transferOwnershipFn({ data: { to_id: to, password: pw } });
      toast.success("تم نقل الملكية");
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e.message || "حدث خطأ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mil-card p-6">
      <h2 className="font-bold mb-1 flex items-center gap-2"><Crown className="h-4 w-4 text-[var(--gold)]" />نقل ملكية الموقع</h2>
      <p className="text-xs text-muted-foreground mb-3 leading-loose">تنقل صلاحية الأدمن الأساسي لحساب تاني، وحسابك بيتحول لحساب عادي (بصلاحيات رتبك). الحساب الجديد يقدر ينقلها لغيره بنفس الطريقة.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">اختار الحساب...</option>
          {list.map((u) => <option key={u.id} value={u.id}>{u.name}{u.character_name ? ` — ${u.character_name}` : ""}</option>)}
        </select>
        <input className="input" type="password" placeholder="كلمة مرورك للتأكيد" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <button onClick={go} disabled={!to || !pw || busy} className="btn-gold ripple mt-3 disabled:opacity-40">{busy ? "جارٍ النقل..." : "نقل الملكية"}</button>
    </div>
  );
}
