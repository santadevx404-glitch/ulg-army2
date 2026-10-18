import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Shield } from "lucide-react";
import { loginFn, signupFn, currentUserFn } from "@/lib/server-fns";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — حرس الحدود" },
      { name: "description", content: "دخول المطور إلى لوحة تحكم موقع حرس الحدود." },
      { property: "og:title", content: "تسجيل الدخول — حرس الحدود" },
      { property: "og:description", content: "دخول المطور إلى لوحة تحكم موقع حرس الحدود." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const res = await loginFn({ data: { identifier: email, password } });
        if ("error" in res && res.error) throw new Error(res.error);
        toast.success("تم تسجيل الدخول");
        const me = await currentUserFn();
        qc.setQueryData(["me"], me);
        navigate({ to: me && me.tabs.length > 0 ? "/admin" : "/profile" });
      } else {
        const res = await signupFn({ data: { email, password } });
        if (res.error) throw new Error(res.error);
        toast.success("تم إنشاء الحساب. سجّل دخول الآن.");
        setMode("login");
      }
    } catch (err: any) {
      toast.error(err.message || "حدث خطأ");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="mil-card p-8 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex p-4 rounded-full bg-gradient-to-br from-[var(--gold)] to-[oklch(0.55_0.1_70)] mb-4 shadow-[var(--shadow-glow)]">
            <Shield className="h-8 w-8 text-[oklch(0.18_0.02_80)]" />
          </div>
          <h1 className="text-2xl font-bold gold-text">{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب المطور"}</h1>
          <p className="text-sm text-muted-foreground mt-1">لوحة تحكم موقع حرس الحدود</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm mb-1 block">{mode === "login" ? "الإيميل أو اسم الحساب" : "البريد الإلكتروني"}</label>
            <input type={mode === "login" ? "text" : "email"} dir="auto" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-input border border-border focus:border-[var(--gold)] outline-none transition" />
          </div>
          <div>
            <label className="text-sm mb-1 block">كلمة المرور</label>
            <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-input border border-border focus:border-[var(--gold)] outline-none transition" />
          </div>
          <button type="submit" disabled={loading} className="btn-gold w-full ripple disabled:opacity-50">
            {loading ? "..." : mode === "login" ? "دخول" : "إنشاء حساب"}
          </button>
        </form>

        <Link to="/register" className="block w-full text-center text-sm text-muted-foreground hover:text-[var(--gold)] mt-6">
          لا تملك حسابًا؟ طلب إنشاء حساب
        </Link>
        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-center text-xs text-muted-foreground/60 hover:text-[var(--gold)] mt-3"
        >
          {mode === "login" ? "إنشاء حساب المطور (للأدمن الأساسي فقط)" : "رجوع لتسجيل الدخول"}
        </button>
      </motion.div>
    </div>
  );
}
