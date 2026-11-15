// حالة السايد بار (مطوي/مفتوح) على الكمبيوتر.
// pref: اختيار المستخدم (بيتحفظ)، override: إجبار مؤقت (مثلاً وقت عرض الدورة).
import { useSyncExternalStore } from "react";

const KEY = "sidebar-collapsed";
let pref = false;
let override: boolean | null = null;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { pref = localStorage.getItem(KEY) === "1"; } catch { /* ignore */ }
}
const emit = () => subs.forEach((f) => f());

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => { load(); return override ?? pref; },
    () => false,
  );
}

export function toggleSidebar() {
  load();
  if (override !== null) override = !override;
  else {
    pref = !pref;
    try { localStorage.setItem(KEY, pref ? "1" : "0"); } catch { /* ignore */ }
  }
  emit();
}

/** بيتنادى لما الصفحة تتغير: صفحات العرض بتطوي السايد بار إجباري (ويتفتح بالزرار). */
export function setSidebarForcedCollapsed(forced: boolean) {
  const next = forced ? true : null;
  if (override === next) return;
  override = next;
  emit();
}
