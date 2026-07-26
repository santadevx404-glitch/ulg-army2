import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Shield } from "lucide-react";
import { loginFn, signupFn } from "@/lib/server-fns";

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
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const res = await loginFn({ data: { email, password } });
        if ("error" in res && res.error) throw new Error(res.error);
        toast.success("تم تسجيل الدخول");
        navigate({ to: "/admin" });
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
          <h1 className="text-2xl font-bold gold-text">{mode === "login" ? "دخول المطور" : "إنشاء حساب مطور"}</h1>
          <p className="text-sm text-muted-foreground mt-1">لوحة تحكم موقع حرس الحدود</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm mb-1 block">البريد الإلكتروني</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
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

        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="w-full text-center text-sm text-muted-foreground hover:text-[var(--gold)] mt-6"
        >
          {mode === "login" ? "لا تملك حسابًا؟ إنشاء حساب" : "لديك حساب؟ تسجيل الدخول"}
        </button>
      </motion.div>
    </div>
  );
}
