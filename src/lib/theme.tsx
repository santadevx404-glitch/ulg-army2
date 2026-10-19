// الثيمات: داكن (أسود + ذهبي غامق جدًا) / عادي (الألوان الحالية) / فاتح (أبيض + ذهبي فاتح جدًا).
// بتتحفظ في localStorage عند كل شخص لوحده، وبتتطبق على <html data-theme="..."> قبل ما الصفحة تترسم (من غير وميض).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "normal" | "light";
export const THEME_KEY = "bwd_theme";

/** سكريبت صغير بيتحط في <head> ويطبّق الثيم المحفوظ فورًا. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light"||t==="normal")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "normal", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("normal");

  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "dark" || t === "light" || t === "normal") setThemeState(t);
    } catch { /* التخزين المحلي مش متاح */ }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* تجاهل */ }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
