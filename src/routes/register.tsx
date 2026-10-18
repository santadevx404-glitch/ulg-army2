import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CheckCircle2, UserPlus } from "lucide-react";
import { publicRankNamesFn, requestAccountFn } from "@/lib/account-fns";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "طلب إنشاء حساب — حرس الحدود" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { data: rankNames = [] } = useQuery({ queryKey: ["public-rank-names"], queryFn: () => publicRankNamesFn() });
  const [f, setF] = useState({ account_name: "", character_name: "", military_code: "", rank_requested: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await requestAccountFn({ data: f });
      if (res.error) throw new Error(res.error);
      setDone(true);
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ");
    } finally { setLoading(false); }
  };

  const inputCls = "w-full px-4 py-2.5 rounded-lg bg-input border border-border focus:border-[var(--gold)] outline-none transition";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mil-card p-8 w-full max-w-md">
        {done ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-14 w-14 mx-auto text-[var(--gold)] mb-4" />
            <h1 className="text-2xl font-bold gold-text mb-2">وصل طلبك</h1>
            <p className="text-sm text-muted-foreground mb-6">الإدارة هتراجع الطلب. لما يتقبل تقدر تسجّل دخول بالإيميل وكلمة المرور اللي كتبتهم.</p>
            <Link to="/auth" className="btn-gold ripple inline-block">تسجيل الدخول</Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="inline-flex p-4 rounded-full bg-gradient-to-br from-[var(--gold)] to-[oklch(0.55_0.1_70)] mb-4 shadow-[var(--shadow-glow)]">
                <UserPlus className="h-8 w-8 text-[oklch(0.18_0.02_80)]" />
              </div>
              <h1 className="text-2xl font-bold gold-text">طلب إنشاء حساب عسكري</h1>
              <p className="text-sm text-muted-foreground mt-1">املأ بياناتك وهيتراجع الطلب من الإدارة</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div><label className="text-sm mb-1 block">اسم حسابك</label><input required maxLength={80} value={f.account_name} onChange={set("account_name")} className={inputCls} /></div>
              <div><label className="text-sm mb-1 block">اسم الشخصية</label><input required maxLength={80} value={f.character_name} onChange={set("character_name")} className={inputCls} /></div>
              <div><label className="text-sm mb-1 block">الكود العسكري</label><input required maxLength={40} value={f.military_code} onChange={set("military_code")} className={inputCls} /></div>
              <div>
                <label className="text-sm mb-1 block">رتبتك</label>
                <input required maxLength={60} list="rank-suggestions" value={f.rank_requested} onChange={set("rank_requested")} className={inputCls} />
                <datalist id="rank-suggestions">{rankNames.map((n) => <option key={n} value={n} />)}</datalist>
              </div>
              <div><label className="text-sm mb-1 block">الإيميل الخاص بك</label><input type="email" required dir="ltr" value={f.email} onChange={set("email")} className={inputCls} /></div>
              <div><label className="text-sm mb-1 block">الباسوورد الخاص بك</label><input type="password" required minLength={6} maxLength={128} dir="ltr" value={f.password} onChange={set("password")} className={inputCls} /></div>
              <button type="submit" disabled={loading} className="btn-gold w-full ripple disabled:opacity-50">{loading ? "..." : "إرسال الطلب"}</button>
            </form>

            <Link to="/auth" className="block w-full text-center text-sm text-muted-foreground hover:text-[var(--gold)] mt-6">عندك حساب؟ تسجيل الدخول</Link>
          </>
        )}
      </motion.div>
    </div>
  );
}
