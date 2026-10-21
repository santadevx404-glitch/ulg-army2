// "استثناء من كلمة السر": أشخاص أو رتب معينة تدخل القسم / العنصر / الاختبار المقفول من غير ما تكتب كلمة السر
// (وخانة كلمة السر مبتظهرلهمش أصلًا). بيتخزّن على الحاجة المقفولة نفسها.

export type Bypass = { user_ids: string[]; rank_ids: string[] };
/** الزائر الحالي (null = مش مسجل دخول). */
export type Viewer = { id: string; owner: boolean; rank_ids: string[] } | null;

/** بينضّف القيمة الجاية من التخزين/العميل. بيرجع null لو مفيش حد مستثنى. */
export function normBypass(b: unknown): Bypass | null {
  if (!b || typeof b !== "object") return null;
  const raw = b as Partial<Bypass>;
  const strs = (a: unknown) => [...new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && !!x) : [])].slice(0, 500);
  const out = { user_ids: strs(raw.user_ids), rank_ids: strs(raw.rank_ids) };
  return out.user_ids.length || out.rank_ids.length ? out : null;
}

/** هل الزائر ده يدخل من غير كلمة سر؟ صاحب الموقع دايمًا، وبعده المستثنين بالاسم أو بالرتبة. */
export function bypasses(viewer: Viewer, b: Bypass | null | undefined): boolean {
  if (!viewer) return false;
  if (viewer.owner) return true;
  if (!b) return false;
  return b.user_ids.includes(viewer.id) || b.rank_ids.some((r) => viewer.rank_ids.includes(r));
}
