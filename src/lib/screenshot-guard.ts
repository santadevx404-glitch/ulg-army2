// حماية "best effort" للصور البرايفت من لقطات الشاشة: بنخفي الصورة (تبقى سودة) في اللحظات اللي ممكن
// يتاخد فيها سكرين: زرار PrintScreen، زرار Win/Cmd (لقطات Win+Shift+S و Cmd+Shift+3/4/5)،
// خروج التاب من التركيز (Alt+Tab لأداة لقطات)، تغيير التاب، أو الطباعة.
// ملحوظة مهمة: المتصفح مفيهوش طريقة مضمونة لمنع/كشف السكرين (خصوصًا على الموبايل أو تصوير الشاشة بكاميرا)،
// فده رادع مش حماية مطلقة.
import { useEffect, useState } from "react";

export function useScreenshotGuard(active: boolean): boolean {
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!active) { setCovered(false); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const holdCover = (ms: number) => {
      setCovered(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (document.hasFocus() && document.visibilityState === "visible") setCovered(false); }, ms);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "OS" || e.key === "PrintScreen" || e.key === "Snapshot" || e.metaKey) holdCover(1500);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || e.key === "Snapshot") {
        holdCover(2500);
        try { navigator.clipboard?.writeText(""); } catch { /* مش مشكلة */ }
      } else if (e.key === "Meta" || e.key === "OS") holdCover(800);
    };
    const onBlur = () => setCovered(true);
    const onFocus = () => holdCover(300);
    const onVisibility = () => { if (document.visibilityState === "hidden") setCovered(true); else holdCover(300); };
    const onBeforePrint = () => setCovered(true);

    if (!document.hasFocus()) setCovered(true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeprint", onBeforePrint);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeprint", onBeforePrint);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  return covered;
}
