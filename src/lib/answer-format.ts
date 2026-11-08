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

export function parseFix(a: string): { from: string; to: string } | null {
  try {
    const o = JSON.parse(a);
    if (o && typeof o.from === "string") return { from: o.from, to: typeof o.to === "string" ? o.to : "" };
  } catch { /* ignore */ }
  return null;
}
export const buildFix = (from: string, to: string) => (from ? JSON.stringify({ from, to }) : "");

/** نص مقروء للإجابة (للأدمن وللطالب في النتائج). */
export function formatAnswer(type: string, a: string): string {
  const s = (a ?? "").trim();
  if (!s) return "";
  if (type === "tf_fix") {
    const { verdict, fix } = parseTfFix(s);
    return fix ? `${verdict} — التصويب: ${fix}` : verdict;
  }
  if (type === "fix") {
    const f = parseFix(s);
    return f ? `غيّر «${f.from}» إلى «${f.to || "…"}»` : s;
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
