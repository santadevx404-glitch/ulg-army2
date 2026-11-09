// أشكال الإجابات للأنواع الجديدة (آمن للسيرفر والمتصفح).
//  tf      : "صح" | "خطأ"
//  tf_fix  : "صح" | "خطأ" أو "خطأ\n<التصويب>"
//  fix     : JSON {"from": "الكلمة المحددة", "to": "الصح"}

export const TF_TRUE = "صح";
export const TF_FALSE = "خطأ";

export function parseTfFix(a: string): { verdict: string; fix: string } {
  const s = (a ?? "").replace(/\r/g, "");
  const i = s.indexOf("\n");
  const verdict = (i < 0 ? s : s.slice(0, i)).trim();
  const fix = i < 0 ? "" : s.slice(i + 1).trim();
  return { verdict, fix };
}
export function buildTfFix(verdict: string, fix: string): string {
  if (!verdict) return "";
  return verdict === TF_FALSE && fix ? `${verdict}\n${fix}` : verdict;
}

// ---- "صحح المعلومة": الطالب يعلّم كلمات/أجزاء/أسطر في الجملة (حتى لو متباعدة) ويكتب بديل لكل جزء ----
//  الإجابة: JSON {"edits":[{"s":3,"e":4,"from":"الكلمتين الغلط","to":"الصح"}]}
//  s/e = ترتيب أول وآخر كلمة (من 0) في الجملة.

/** إجابة "لا يوجد أخطاء" (الجملة صح) — بتتخزن كـ {"none":true}، وبتتحط كمان كـ correct_answer للسؤال اللي جملته صحيحة. */
export const NO_ERRORS = "لا يوجد أخطاء";
export const buildNone = () => JSON.stringify({ none: true });
export function isNoErrors(a: string): boolean {
  try { return JSON.parse(a)?.none === true; } catch { return false; }
}

export type FixEdit = { s: number; e: number; from: string; to: string };

export type Tok = { t: string; word: boolean; idx: number };
/** تقسيم الجملة لكلمات ومسافات (الكلمات بس هي اللي بتتعلّم). */
export function tokenize(text: string): Tok[] {
  let idx = 0;
  return (text ?? "").split(/(\s+)/).filter((t) => t !== "").map((t) => (/^\s+$/.test(t) ? { t, word: false, idx: -1 } : { t, word: true, idx: idx++ }));
}

export function parseFix(a: string): FixEdit[] {
  try {
    const o = JSON.parse(a);
    if (o && Array.isArray(o.edits)) {
      return o.edits
        .filter((e: any) => e && typeof e.from === "string" && Number.isInteger(e.s) && Number.isInteger(e.e))
        .map((e: any) => ({ s: e.s, e: e.e, from: e.from, to: typeof e.to === "string" ? e.to : "" }));
    }
    // شكل قديم: تعديل واحد
    if (o && typeof o.from === "string") return [{ s: -1, e: -1, from: o.from, to: typeof o.to === "string" ? o.to : "" }];
  } catch { /* ignore */ }
  return [];
}
export const buildFix = (edits: FixEdit[]) => (edits.length ? JSON.stringify({ edits: edits.map((e) => ({ s: e.s, e: e.e, from: e.from, to: e.to })) }) : "");

/** الجملة بعد تطبيق التعديلات (الأجزاء المعدّلة بين « »). */
export function applyFix(text: string, edits: FixEdit[]): string {
  const ranged = edits.filter((e) => e.s >= 0);
  if (!ranged.length) return "";
  let out = "";
  let skipUntil = -1;
  let pendingWs = "";
  for (const tk of tokenize(text)) {
    if (!tk.word) { pendingWs += tk.t; continue; }
    if (tk.idx <= skipUntil) { pendingWs = ""; continue; } // مسافات داخل الجزء المعدّل بتتشال
    const ed = ranged.find((e) => e.s === tk.idx);
    out += pendingWs;
    pendingWs = "";
    if (ed) { out += `«${ed.to.trim() || "…"}»`; skipUntil = ed.e; } else out += tk.t;
  }
  return out;
}

/** نص مقروء للإجابة (للأدمن وللطالب في النتائج). */
export function formatAnswer(type: string, a: string): string {
  const s = (a ?? "").trim();
  if (!s) return "";
  if (type === "tf_fix") {
    const { verdict, fix } = parseTfFix(s);
    return fix ? `${verdict} — التصويب: ${fix}` : verdict;
  }
  if (type === "fix") {
    if (isNoErrors(s)) return NO_ERRORS;
    const edits = parseFix(s);
    return edits.length ? edits.map((e) => `«${e.from}» ← «${e.to || "…"}»`).join("\n") : s;
  }
  return s;
}

/** مقارنة متسامحة: مسافات، تشكيل، تطويل، وأشكال الألف. */
export function normText(s: string): string {
  return (s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
