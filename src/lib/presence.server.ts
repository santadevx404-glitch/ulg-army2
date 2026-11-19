// مين فاتح الموقع دلوقتي وفي أنهي صفحة (heartbeat من المتصفح كل 30 ثانية).
import { kvGetJSON, kvSetJSON, makeLock } from "./kv-store.server";

type Entry = { t: number; path: string };
const KEY = "presence-v1";
const withLock = makeLock();
export const ONLINE_MS = 80_000; // اللي آخر نبضة ليه أقدم من كده بيتعتبر مش متصل

export async function touch(uid: string, path: string): Promise<void> {
  await withLock(async () => {
    const now = Date.now();
    const cur = await kvGetJSON<Record<string, Entry>>(KEY, {});
    const next: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(cur)) if (now - v.t < ONLINE_MS * 3) next[k] = v;
    next[uid] = { t: now, path: String(path || "/").slice(0, 200) };
    await kvSetJSON(KEY, next);
  });
}

export async function onlineEntries(): Promise<Record<string, Entry>> {
  const now = Date.now();
  const cur = await kvGetJSON<Record<string, Entry>>(KEY, {});
  return Object.fromEntries(Object.entries(cur).filter(([, v]) => now - v.t < ONLINE_MS));
}

/** اسم الصفحة بالعربي من المسار (من غير ما نكشف تفاصيل حساسة زي اسم الاختبار). */
export function pageLabel(rawPath: string, sections: { slug: string; name: string }[], items: { id: string; title: string; published: boolean }[]): string {
  let path = "/";
  try { path = decodeURIComponent(rawPath.split("?")[0].split("#")[0]); } catch { path = rawPath.split("?")[0]; }
  if (path.length > 1) path = path.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  const [a, b, c] = parts;
  if (!a) return "الصفحة الرئيسية";
  if (a === "s" && b) {
    const sec = sections.find((s) => s.slug === b);
    if (c) {
      const it = items.find((i) => i.id === c && i.published);
      return it ? `${sec ? sec.name + " ← " : ""}${it.title}` : sec ? `قسم ${sec.name}` : "أحد الأقسام";
    }
    return sec ? `قسم ${sec.name}` : "أحد الأقسام";
  }
  if (a === "exams") return !b ? "قائمة الاختبارات" : b === "results" ? "نتائج الاختبارات" : "يؤدّي اختبارًا";
  if (a === "admin") return "لوحة التحكم";
  if (a === "profile") return "حسابه الشخصي";
  if (a === "chat") return b ? "داخل دردشة" : "الدردشات";
  if (a === "auth" || a === "register") return "تسجيل الدخول";
  return "الموقع";
}
