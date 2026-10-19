// حالة عامة بسيطة: هل في عارض صور مفتوح؟ (السايد بار بيستخدمها عشان يستخبى لما الصورة تتفتح ويرجع لما تتقفل)
import { useSyncExternalStore } from "react";

let openCount = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function setLightboxOpen(open: boolean) {
  openCount = Math.max(0, openCount + (open ? 1 : -1));
  emit();
}

export function useLightboxOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => { subs.delete(cb); }; },
    () => openCount > 0,
    () => false,
  );
}
