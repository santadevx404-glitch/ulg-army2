import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  Home, Award, Crosshair, Truck, GraduationCap, MapPin,
  Shield, Menu, X, Settings, LogOut, LogIn, Gauge, ClipboardList, MessageSquare, User, UserPlus, Moon, Sun, Contrast,
} from "lucide-react";
import { sectionsQuery } from "@/lib/queries";
import { logoutFn } from "@/lib/server-fns";
import { useMe } from "@/lib/use-me";
import { usePerformanceMode } from "@/lib/performance-mode";
import { useLightboxOpen } from "@/lib/lightbox-state";
import { useTheme, type Theme } from "@/lib/theme";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Award, Crosshair, Truck, GraduationCap, MapPin, Shield,
};

export function Sidebar() {
  const { data: sections = [] } = useQuery(sectionsQuery);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { me } = useMe();
  const authed = !!me;
  const isAdmin = !!me && me.tabs.length > 0;
  const { lite, setLite } = usePerformanceMode();
  const { theme, setTheme } = useTheme();
  const lightboxOpen = useLightboxOpen(); // لما صورة تتفتح السايد بار يدخل جوا البار بتاعه

  useEffect(() => { setOpen(false); }, [path]);

  const links = [
    { to: "/", label: "الرئيسية", icon: Home },
    ...sections.map((s) => ({
      to: `/s/${s.slug}` as const,
      label: s.name,
      icon: (s.icon && iconMap[s.icon]) || Shield,
    })),
    { to: "/exams" as const, label: "الاختبارات", icon: ClipboardList },
    ...(authed ? [{ to: "/chat" as const, label: "الدردشات", icon: MessageSquare }] : []),
  ];

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`lg:hidden fixed top-4 right-4 z-50 p-2 rounded-md bg-card border border-border ripple transition-opacity ${lightboxOpen ? "opacity-0 pointer-events-none" : ""}`}
        aria-label="القائمة"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      <motion.aside
        initial={false}
        animate={{ x: 0 }}
        className={`fixed top-0 right-0 h-screen w-72 z-40 border-l border-border
          bg-gradient-to-b from-[var(--sidebar-from)] to-[var(--sidebar-to)]
          backdrop-blur-xl transition-transform duration-300
          ${open ? "translate-x-0" : "translate-x-full"} lg:translate-x-0 ${lightboxOpen ? "sidebar-away" : ""}`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-border">
            <Link to="/" className="flex items-center gap-3 group">
              <div className="p-2 rounded-lg bg-gradient-to-br from-[var(--gold)] to-[oklch(0.6_0.12_75)] shadow-[var(--shadow-glow)] group-hover:scale-110 transition">
                <Shield className="h-6 w-6 text-[oklch(0.18_0.02_80)]" />
              </div>
              <div>
                <div className="font-bold text-lg gold-text leading-tight">حرس الحدود</div>
                <div className="text-xs text-muted-foreground">Border Guard</div>
              </div>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {links.map((l, i) => {
              const active = path === l.to || (l.to !== "/" && path.startsWith(l.to));
              const Icon = l.icon;
              return (
                <motion.div
                  key={l.to}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to={l.to}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg group transition-all ripple
                      ${active
                        ? "bg-gradient-to-l from-[var(--gold)]/20 to-transparent border-r-2 border-[var(--gold)] text-[var(--gold)]"
                        : "hover:bg-white/5 text-foreground/80 hover:text-foreground"}`}
                  >
                    <Icon className={`h-5 w-5 transition-transform group-hover:scale-110 ${active ? "text-[var(--gold)]" : ""}`} />
                    <span className="font-medium">{l.label}</span>
                  </Link>
                </motion.div>
              );
            })}
          </nav>

          <div className="p-3 border-t border-border space-y-1">
            <div className="px-1 pb-1">
              <div className="text-xs text-muted-foreground mb-1.5 px-3">المظهر</div>
              <div role="radiogroup" aria-label="المظهر" className="grid grid-cols-3 gap-1 rounded-lg border border-border p-1">
                {([
                  { id: "dark", label: "داكن", icon: Moon },
                  { id: "normal", label: "عادي", icon: Contrast },
                  { id: "light", label: "فاتح", icon: Sun },
                ] as { id: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[]).map((t) => {
                  const on = theme === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setTheme(t.id)}
                      title={`المظهر ${t.label}`}
                      className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-xs transition-colors ${on ? "bg-[var(--gold)] text-[oklch(0.15_0.02_80)] font-bold" : "text-foreground/70 hover:text-foreground hover:bg-white/5"}`}
                    >
                      <Icon className="h-4 w-4" />{t.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => setLite(!lite)}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors
                ${lite ? "bg-[var(--gold)]/15 text-[var(--gold)]" : "hover:bg-white/5 text-foreground/70"}`}
              title="تقليل الحركات والتأثيرات على جهازك أنت بس"
            >
              <span className="flex items-center gap-3">
                <Gauge className="h-4 w-4" />
                وضع الأجهزة الضعيفة
              </span>
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0
                  ${lite ? "bg-[var(--gold)]" : "bg-white/15"}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
                    ${lite ? "-translate-x-1" : "-translate-x-4"}`}
                />
              </span>
            </button>

            {isAdmin && (
              <Link to="/admin" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm hover:bg-white/5 text-[var(--gold)]">
                <Settings className="h-4 w-4" />لوحة التحكم
              </Link>
            )}
            {authed && (
              <Link to="/profile" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm hover:bg-white/5 text-foreground/70">
                <User className="h-4 w-4" />حسابي
              </Link>
            )}
            {authed ? (
              <button
                onClick={async () => {
                  await logoutFn();
                  qc.setQueryData(["me"], null);
                  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm hover:bg-white/5 text-foreground/70"
              >
                <LogOut className="h-4 w-4" />تسجيل خروج
              </button>
            ) : (
              <>
                <Link to="/auth" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm hover:bg-white/5 text-foreground/70">
                  <LogIn className="h-4 w-4" />تسجيل الدخول
                </Link>
                <Link to="/register" className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm hover:bg-white/5 text-[var(--gold)]">
                  <UserPlus className="h-4 w-4" />طلب إنشاء حساب
                </Link>
              </>
            )}
          </div>
        </div>
      </motion.aside>

      {open && <div className="lg:hidden fixed inset-0 bg-black/60 z-30" onClick={() => setOpen(false)} />}
    </>
  );
}
