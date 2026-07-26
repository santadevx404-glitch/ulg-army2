import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "bwd_lite_mode";

type PerformanceModeContextValue = {
  lite: boolean;
  setLite: (value: boolean) => void;
};

const PerformanceModeContext = createContext<PerformanceModeContextValue>({
  lite: false,
  setLite: () => {},
});

/**
 * وضع "الأجهزة الضعيفة": بيتفعّل من كل جهاز/متصفح لوحده (متخزن في localStorage
 * المحلي بتاع الشخص بس)، ولما يتفعّل بيقفل الأنيميشنات والتأثيرات الثقيلة
 * (الخلفية المتحركة، البلور، الحركات) عند اللي فعّله بس — باقي الزوار مش بيتأثروا.
 */
export function PerformanceModeProvider({ children }: { children: ReactNode }) {
  const [lite, setLiteState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setLiteState(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage غير متاح (وضع تصفح خاص مثلاً) — نتجاهل ونكمل عادي
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.setAttribute("data-lite", lite ? "true" : "false");
  }, [lite, hydrated]);

  const setLite = (value: boolean) => {
    setLiteState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // تجاهل لو التخزين المحلي غير متاح
    }
  };

  return (
    <PerformanceModeContext.Provider value={{ lite, setLite }}>
      {children}
    </PerformanceModeContext.Provider>
  );
}

export function usePerformanceMode() {
  return useContext(PerformanceModeContext);
}
