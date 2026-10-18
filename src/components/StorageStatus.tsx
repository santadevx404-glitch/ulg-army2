// شارة وضع التخزين (للأدمن الأساسي) + فحص كامل للاتصال بـ Supabase.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Database, Loader2, XCircle } from "lucide-react";
import { Modal } from "@/components/admin-ui";

type Step = { name: string; ok: boolean; detail: string; hint?: string };
type Check = { ok: boolean; steps: Step[]; info: { mode: string; host: string | null } };

export function StorageStatus() {
  const { data } = useQuery({
    queryKey: ["storage-mode"],
    queryFn: async () => (await fetch("/api/storage-check?quick=1")).json() as Promise<{ info?: { mode: string; host: string | null } }>,
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true); setError(""); setResult(null);
    try {
      const r = await fetch("/api/storage-check");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "فشل الفحص");
      setResult(j);
    } catch (e: any) { setError(e.message || "فشل الفحص"); }
    finally { setRunning(false); }
  };

  const mode = data?.info?.mode;
  if (!mode) return null;

  return (
    <>
      <button onClick={() => { setOpen(true); run(); }} className={`inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition ${mode === "supabase" ? "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10" : "border-amber-500/50 text-amber-400 hover:bg-amber-500/10"}`} title="فحص الاتصال بقاعدة البيانات">
        <Database className="h-3.5 w-3.5" />
        {mode === "supabase" ? "قاعدة البيانات: Supabase" : "التخزين: ملفات لوكال"}
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} title="فحص التخزين وقاعدة البيانات">
          <div className="text-sm text-muted-foreground mb-4">
            الوضع الحالي: <b className="text-foreground">{mode === "supabase" ? `Supabase (${data?.info?.host ?? ""})` : "ملفات لوكال في مجلد data/"}</b>
          </div>
          {running && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />جارٍ الفحص...</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          {result && (
            <div className="space-y-3">
              {result.steps.map((s) => (
                <div key={s.name} className="flex gap-3 text-sm">
                  {s.ok ? <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /> : <XCircle className="h-5 w-5 text-destructive shrink-0" />}
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className={s.ok ? "text-muted-foreground" : "text-destructive"} dir="auto">{s.detail}</div>
                    {s.hint && <div className="text-[var(--gold)] mt-1">← {s.hint}</div>}
                  </div>
                </div>
              ))}
              <div className={`text-sm font-bold pt-2 ${result.ok ? "text-emerald-400" : "text-destructive"}`}>{result.ok ? "كل حاجة شغالة ✓" : "في حاجة محتاجة تتظبط ✗"}</div>
            </div>
          )}
          <button onClick={run} disabled={running} className="btn-gold ripple mt-5 disabled:opacity-50">إعادة الفحص</button>
        </Modal>
      )}
    </>
  );
}
