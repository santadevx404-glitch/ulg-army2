// تعريف الصلاحيات — ملف مشترك بين السيرفر والمتصفح (مفيش فيه أي حاجة سيرفر).
//
// نظام هرمي: مفتاح الأب بيغطي كل اللي تحته.
//   "items"                  = كل حاجة في العناصر
//   "items.edit"             = تعديل أي حقل في العنصر
//   "items.edit.title"       = تعديل عنوان العنصر بس
//
// ممكن تتحدد على مستوى محدد بإضافة @نوع:id:
//   "items.edit@item:<id>"        على عنصر واحد
//   "items.create@section:<id>"   على قسم واحد
//   "exams.review@exam:<id>"      على اختبار واحد
//   "*@section:<id>"              = كل حاجة تخص القسم ده (القسم نفسه + عناصره + مواضيعها)
//   "*@item:<id>" / "*@exam:<id>" / "*@chat:<id>" / "*@announcement:<id>" = نفس الفكرة للعنصر / الاختبار / الدردشة / الإعلان
// صاحب الموقع (owner) بيعدّي على كل الفحوصات دي.

export type ScopeType = "section" | "item" | "exam" | "chat" | "announcement";
export type Scope = { section?: string; item?: string; exam?: string; chat?: string; announcement?: string };
const SCOPE_TYPES = ["section", "item", "exam", "chat", "announcement"] as const;

export type PNode = { key: string; label: string; children?: PNode[] };
export type FieldGroup = { id: string; label: string; fields: string[] };

// ============================== حقول كل نوع ==============================

export const SECTION_FIELDS: FieldGroup[] = [
  { id: "name", label: "اسم القسم", fields: ["name"] },
  { id: "slug", label: "المُعرِّف (الرابط)", fields: ["slug"] },
  { id: "icon", label: "الأيقونة", fields: ["icon"] },
  { id: "order", label: "الترتيب", fields: ["sort_order"] },
  { id: "visibility", label: "الظهور للزوار", fields: ["visible"] },
  { id: "password", label: "كلمة سر القسم", fields: ["password"] },
];

export const ITEM_FIELDS: FieldGroup[] = [
  { id: "title", label: "العنوان", fields: ["title"] },
  { id: "short_description", label: "الوصف المختصر", fields: ["short_description"] },
  { id: "full_description", label: "الوصف الكامل", fields: ["full_description"] },
  { id: "cover", label: "صورة الغلاف", fields: ["cover_image"] },
  { id: "gallery", label: "معرض الصور", fields: ["gallery"] },
  { id: "published", label: "النشر والإخفاء", fields: ["published"] },
  { id: "order", label: "الترتيب", fields: ["sort_order"] },
  { id: "topics_mode", label: "تفعيل نظام المواضيع", fields: ["use_topics"] },
  { id: "password", label: "كلمة سر العنصر", fields: ["password"] },
  { id: "section", label: "نقل لقسم تاني", fields: ["section_id"] },
];

export const TOPIC_FIELDS: FieldGroup[] = [
  { id: "title", label: "عنوان الموضوع", fields: ["title"] },
  { id: "content", label: "المحتوى", fields: ["content"] },
  { id: "images", label: "الصور", fields: ["images"] },
  { id: "order", label: "الترتيب", fields: ["sort_order"] },
];

export const EXAM_SETTINGS_FIELDS: FieldGroup[] = [
  { id: "title", label: "عنوان الاختبار", fields: ["title"] },
  { id: "description", label: "الوصف ورسالة ما قبل البدء", fields: ["description", "intro_message"] },
  { id: "fields", label: "حقول بيانات الدخول", fields: ["fields"] },
  { id: "limits", label: "الأسئلة الاختيارية والمدة وتاريخ الانتهاء", fields: ["optional_count", "attempt_minutes", "ends_at"] },
  { id: "options", label: "الترتيب العشوائي وحظر تبديل التاب", fields: ["shuffle", "block_on_tab_switch"] },
  { id: "publish", label: "النشر والإخفاء", fields: ["published"] },
  { id: "messages", label: "رسائل التسليم والوقت والحظر والانتهاء", fields: ["submit_message", "timeout_message", "block_message", "closed_message"] },
  { id: "access", label: "نوع الاختبار وكلمة السر", fields: ["access", "password"] },
];

/** الحقول (أو المجموعات) اللي اتغيّرت بين الموجود والجديد. بتتقارن بالقيمة مش بالمرجع. */
export function changedGroups(defs: FieldGroup[], existing: Record<string, unknown>, incoming: Record<string, unknown>): FieldGroup[] {
  // الفاضي (null / undefined / "" / []) كله نفس القيمة، عشان حقل فاضي ما يتحسبش تغيير
  const norm = (v: unknown) => (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) ? null : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  return defs.filter((g) => g.fields.some((f) => f in incoming && !same(existing[f], incoming[f])));
}

// ============================== الشجرة ==============================

const fieldNodes = (prefix: string, defs: FieldGroup[]): PNode[] =>
  defs.map((g) => ({ key: `${prefix}.${g.id}`, label: g.label }));

export const CHAT_FIELDS: FieldGroup[] = [
  { id: "name", label: "اسم الدردشة", fields: ["name"] },
  { id: "description", label: "الوصف", fields: ["description"] },
  { id: "ranks", label: "الرتب اللي تقدر تفتحها", fields: ["rank_ids"] },
  { id: "images", label: "السماح بإرسال الصور", fields: ["allow_images"] },
  { id: "display", label: "ترتيب ظهور الرتب جنب الأسماء في الدردشة", fields: ["rank_display_order"] },
  { id: "status", label: "تشغيل / إيقاف الدردشة", fields: ["enabled"] },
];

export const ANNOUNCEMENT_FIELDS: FieldGroup[] = [
  { id: "title", label: "عنوان الإعلان", fields: ["title"] },
  { id: "body", label: "نص الإعلان والرابط", fields: ["body", "link_url", "link_label"] },
  { id: "image", label: "صورة الإعلان", fields: ["image"] },
  { id: "targets", label: "أماكن ظهور الإعلان", fields: ["targets"] },
  { id: "audience", label: "مين يشوف الإعلان (الجمهور والرتب)", fields: ["audience", "rank_ids"] },
  { id: "style", label: "الشكل (اللون والفتح والإغلاق)", fields: ["tone", "open_by_default", "dismissible"] },
  { id: "schedule", label: "الجدولة (بداية ونهاية)", fields: ["starts_at", "ends_at"] },
  { id: "status", label: "التشغيل والترتيب", fields: ["enabled", "sort_order"] },
];

export const SECTIONS_EDIT: PNode = { key: "sections.edit", label: "تعديل بيانات القسم", children: fieldNodes("sections.edit", SECTION_FIELDS) };
export const SECTIONS_DELETE: PNode = { key: "sections.delete", label: "حذف القسم" };

export const TOPICS_NODE: PNode = {
  key: "items.topics",
  label: "المواضيع (للدورات)",
  children: [
    { key: "items.topics.create", label: "إضافة موضوع" },
    { key: "items.topics.edit", label: "تعديل موضوع", children: fieldNodes("items.topics.edit", TOPIC_FIELDS) },
    { key: "items.topics.delete", label: "حذف موضوع" },
  ],
};
export const ITEMS_EDIT: PNode = { key: "items.edit", label: "تعديل بيانات العنصر", children: fieldNodes("items.edit", ITEM_FIELDS) };
export const ITEMS_DELETE: PNode = { key: "items.delete", label: "حذف العنصر" };

export const CHATS_EDIT: PNode = { key: "chats.edit", label: "تعديل الدردشة", children: fieldNodes("chats.edit", CHAT_FIELDS) };
export const CHATS_DELETE: PNode = { key: "chats.delete", label: "حذف الدردشة بكل رسايلها" };
export const CHATS_MODERATE: PNode = {
  key: "chats.moderate",
  label: "الإشراف على الرسايل",
  children: [
    { key: "chats.moderate.delete_message", label: "حذف رسالة أي حد" },
    { key: "chats.moderate.clear", label: "مسح كل الرسايل" },
  ],
};

export const ANNOUNCEMENTS_EDIT: PNode = { key: "announcements.edit", label: "تعديل الإعلان", children: fieldNodes("announcements.edit", ANNOUNCEMENT_FIELDS) };
export const ANNOUNCEMENTS_DELETE: PNode = { key: "announcements.delete", label: "حذف الإعلان" };

export const EXAMS_MANAGE: PNode = {
  key: "exams.manage",
  label: "إدارة الاختبار",
  children: [
    { key: "exams.manage.settings", label: "الإعدادات", children: fieldNodes("exams.manage.settings", EXAM_SETTINGS_FIELDS) },
    {
      key: "exams.manage.questions",
      label: "بنك الأسئلة",
      children: [
        { key: "exams.manage.questions.view", label: "عرض الأسئلة" },
        { key: "exams.manage.questions.add", label: "إضافة أسئلة" },
        { key: "exams.manage.questions.edit", label: "تعديل أسئلة" },
        { key: "exams.manage.questions.delete", label: "حذف أسئلة" },
      ],
    },
  ],
};
export const EXAMS_REVIEW: PNode = {
  key: "exams.review",
  label: "التسليمات",
  children: [
    { key: "exams.review.view", label: "عرض التسليمات وإجابات الأشخاص" },
    { key: "exams.review.delete", label: "حذف التسليمات" },
  ],
};
export const EXAMS_UNBLOCK: PNode = { key: "exams.unblock", label: "فك الحظر والسماح بمحاولة جديدة" };
export const EXAMS_DELETE: PNode = { key: "exams.delete", label: "حذف الاختبار" };

/** الصلاحيات العامة (على كل حاجة من النوع). */
export const GLOBAL_TREE: PNode[] = [
  {
    key: "sections",
    label: "الأقسام",
    children: [{ key: "sections.create", label: "إنشاء أقسام جديدة" }, SECTIONS_EDIT, SECTIONS_DELETE],
  },
  {
    key: "items",
    label: "العناصر",
    children: [{ key: "items.create", label: "إضافة عناصر" }, ITEMS_EDIT, ITEMS_DELETE, TOPICS_NODE],
  },
  {
    key: "exams",
    label: "الاختبارات",
    children: [{ key: "exams.create", label: "إنشاء اختبارات جديدة" }, EXAMS_DELETE, EXAMS_MANAGE, EXAMS_REVIEW, EXAMS_UNBLOCK],
  },
  {
    key: "chats",
    label: "الدردشات",
    children: [{ key: "chats.create", label: "إنشاء دردشات جديدة" }, CHATS_EDIT, CHATS_DELETE, CHATS_MODERATE],
  },
  {
    key: "announcements",
    label: "الإعلانات",
    children: [{ key: "announcements.create", label: "إنشاء إعلانات جديدة" }, ANNOUNCEMENTS_EDIT, ANNOUNCEMENTS_DELETE],
  },
  {
    key: "accounts",
    label: "الحسابات",
    children: [
      {
        key: "accounts.requests",
        label: "طلبات الحسابات",
        children: [
          { key: "accounts.requests.view", label: "عرض الطلبات" },
          { key: "accounts.requests.approve", label: "قبول طلب" },
          { key: "accounts.requests.reject", label: "رفض طلب" },
        ],
      },
      {
        key: "accounts.members",
        label: "الأعضاء",
        children: [
          { key: "accounts.members.view", label: "عرض الأعضاء" },
          { key: "accounts.members.edit", label: "تعديل بيانات عضو" },
          { key: "accounts.members.password", label: "تغيير كلمة سر عضو" },
          { key: "accounts.members.disable", label: "إيقاف وتفعيل حساب" },
          { key: "accounts.members.delete", label: "حذف حساب" },
        ],
      },
    ],
  },
  {
    key: "ranks",
    label: "الرتب",
    children: [
      { key: "ranks.create", label: "إنشاء رتبة" },
      { key: "ranks.edit", label: "تعديل رتبة" },
      { key: "ranks.delete", label: "حذف رتبة" },
      { key: "ranks.reorder", label: "ترتيب الرتب (اللي بتظهر جنب اسم الشخص)" },
    ],
  },
  {
    key: "staff",
    label: "إدارة الأعضاء والصلاحيات",
    children: [
      { key: "staff.rank", label: "إعطاء وسحب الرتب" },
      { key: "staff.grant", label: "إعطاء ومنع صلاحيات فردية" },
    ],
  },
];

/** الصلاحيات اللي بتتحدد على قسم / عنصر / اختبار معين. */
export const SCOPE_TREES: Record<ScopeType, { title: string; nodes: PNode[] }> = {
  section: {
    title: "قسم",
    nodes: [
      SECTIONS_EDIT,
      SECTIONS_DELETE,
      { key: "items", label: "كل العناصر اللي في القسم", children: [{ key: "items.create", label: "إضافة عناصر فيه" }, ITEMS_EDIT, ITEMS_DELETE, TOPICS_NODE] },
    ],
  },
  item: { title: "عنصر", nodes: [ITEMS_EDIT, ITEMS_DELETE, TOPICS_NODE] },
  exam: { title: "اختبار", nodes: [EXAMS_MANAGE, EXAMS_REVIEW, EXAMS_UNBLOCK, EXAMS_DELETE] },
  chat: { title: "دردشة", nodes: [CHATS_EDIT, CHATS_DELETE, CHATS_MODERATE] },
  announcement: { title: "إعلان", nodes: [ANNOUNCEMENTS_EDIT, ANNOUNCEMENTS_DELETE] },
};

function collect(nodes: PNode[], into: Set<string>) {
  for (const n of nodes) {
    into.add(n.key);
    if (n.children) collect(n.children, into);
  }
}
const GLOBAL_KEYS = new Set<string>();
collect(GLOBAL_TREE, GLOBAL_KEYS);
const SCOPE_KEYS: Record<ScopeType, Set<string>> = { section: new Set(), item: new Set(), exam: new Set(), chat: new Set(), announcement: new Set() };
for (const t of Object.keys(SCOPE_TREES) as ScopeType[]) collect(SCOPE_TREES[t].nodes, SCOPE_KEYS[t]);

export const ALL_GLOBAL_KEYS = GLOBAL_KEYS;

// اسم مقروء لكل مفتاح (مسار الشجرة) — بيستخدم في السجل والعرض
const LABELS = new Map<string, string>();
(function walk(nodes: PNode[], trail: string[]) {
  for (const n of nodes) {
    const t = [...trail, n.label];
    LABELS.set(n.key, t.join(" › "));
    if (n.children) walk(n.children, t);
  }
})(GLOBAL_TREE, []);

export function labelOfBase(base: string): string {
  return base === "*" ? "كل حاجة" : LABELS.get(base) ?? base;
}

export function scopedKey(perm: string, type: ScopeType, id: string): string {
  return `${perm}@${type}:${id}`;
}
export function wildcardKey(type: ScopeType, id: string): string {
  return `*@${type}:${id}`;
}

export function parseKey(key: string): { base: string; type: ScopeType | null; id: string | null } {
  const at = key.indexOf("@");
  if (at === -1) return { base: key, type: null, id: null };
  const base = key.slice(0, at);
  const rest = key.slice(at + 1);
  const colon = rest.indexOf(":");
  return { base, type: rest.slice(0, colon) as ScopeType, id: rest.slice(colon + 1) };
}

/** "items.edit.title" -> ["items.edit.title", "items.edit", "items"] */
export function prefixesOf(base: string): string[] {
  const parts = base.split(".");
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).join("."));
  return out;
}

// مفاتيح النسخة الأولى → الجديدة (عشان أي رتب اتحفظت قبل كده تفضل شغالة)
const LEGACY: Record<string, string> = {
  "accounts.view": "accounts.members.view",
  "accounts.manage": "accounts.members",
  "ranks.manage": "ranks",
  "staff.manage": "staff",
  "exams.review": "exams.review.view",
};
export function migrateKey(key: string): string {
  const { base, type, id } = parseKey(key);
  const nb = LEGACY[base] ?? base;
  return type ? `${nb}@${type}:${id}` : nb;
}

export function isValidKey(key: string): boolean {
  if (typeof key !== "string" || key.length > 200) return false;
  const { base, type, id } = parseKey(key);
  if (type === null) return GLOBAL_KEYS.has(base);
  if (!id || !(type in SCOPE_TREES)) return false;
  return base === "*" || SCOPE_KEYS[type].has(base);
}

export function sanitizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) return [];
  const out = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string") continue;
    const m = migrateKey(k);
    if (isValidKey(m)) out.add(m);
  }
  return [...out];
}

// ============================== الفحوصات ==============================

type PermInput = Iterable<string> | Set<string>;
const toSet = (p: PermInput): Set<string> => (p instanceof Set ? p : new Set(p));

/** عنده الصلاحية دي (عامة، أو على الـ scope المحدد، أو "كل حاجة" على الـ scope)؟ */
export function hasPerm(perms: PermInput, owner: boolean, perm: string, scope?: Scope): boolean {
  if (owner) return true;
  const set = toSet(perms);
  for (const p of prefixesOf(perm)) {
    if (set.has(p)) return true;
    if (scope) {
      for (const t of SCOPE_TYPES) {
        const id = scope[t];
        if (id && set.has(scopedKey(p, t, id))) return true;
      }
    }
  }
  if (scope) {
    for (const t of SCOPE_TYPES) {
      const id = scope[t];
      if (id && set.has(wildcardKey(t, id))) return true;
    }
  }
  return false;
}

const WILDCARD_NS: Record<ScopeType, string[]> = { section: ["sections", "items"], item: ["items"], exam: ["exams"], chat: ["chats"], announcement: ["announcements"] };

function related(base: string, perm: string): boolean {
  return base === perm || base.startsWith(`${perm}.`) || perm.startsWith(`${base}.`);
}

/** عنده أي صلاحية مرتبطة بالمفتاح ده (عامة أو على أي قسم/عنصر/اختبار)؟ بتستخدم لإظهار التابات. */
export function hasAnyPerm(perms: PermInput, owner: boolean, perm: string): boolean {
  if (owner) return true;
  const ns = perm.split(".")[0];
  for (const k of toSet(perms)) {
    const { base, type } = parseKey(k);
    if (base === "*") {
      if (type && WILDCARD_NS[type].includes(ns)) return true;
    } else if (related(base, perm)) return true;
  }
  return false;
}

export function hasAnyOf(perms: PermInput, owner: boolean, list: string[]): boolean {
  return list.some((p) => hasAnyPerm(perms, owner, p));
}

/** نفس hasAnyPerm بس محصورة على scope معين (مثلاً: أي صلاحية على العنصر ده). */
export function hasAnyPermAt(perms: PermInput, owner: boolean, perm: string, scope: Scope): boolean {
  if (owner) return true;
  const ns = perm.split(".")[0];
  for (const k of toSet(perms)) {
    const { base, type, id } = parseKey(k);
    if (type === null) {
      // صلاحيات "إنشاء" العامة مبتدّيش رؤية للحاجات الموجودة (بس القدرة على إنشاء جديد)
      if (base !== "*" && !base.endsWith(".create") && related(base, perm)) return true;
      continue;
    }
    if (!id || scope[type] !== id) continue;
    if (base === "*" ? WILDCARD_NS[type].includes(ns) : related(base, perm)) return true;
  }
  return false;
}

/** هل صلاحياته بتغطي المفتاح ده؟ (بيستخدم في منع تصعيد الصلاحيات) */
export function covers(perms: PermInput, owner: boolean, key: string): boolean {
  if (owner) return true;
  const set = toSet(perms);
  const { base, type, id } = parseKey(key);
  if (base === "*") return set.has(key);
  for (const p of prefixesOf(base)) {
    if (set.has(p)) return true;
    if (type && id && set.has(scopedKey(p, type, id))) return true;
  }
  if (type && id && set.has(wildcardKey(type, id))) return true;
  return false;
}

// ============================== التابات ==============================

export type TabId = "sections" | "items" | "exams" | "submissions" | "blocked" | "chats" | "announcements" | "requests" | "members" | "ranks" | "log";

export const TAB_LABELS: Record<TabId, string> = {
  sections: "الأقسام",
  items: "العناصر",
  exams: "الاختبارات",
  submissions: "التسليمات",
  blocked: "المحظورين",
  chats: "الدردشات",
  announcements: "الإعلانات",
  requests: "طلبات الحسابات",
  members: "الأعضاء",
  ranks: "الرتب",
  log: "سجل الدخول",
};

export const TAB_ORDER: TabId[] = ["sections", "items", "exams", "submissions", "blocked", "chats", "announcements", "requests", "members", "ranks", "log"];

export function canSeeTab(perms: PermInput, owner: boolean, tab: TabId): boolean {
  const any = (...l: string[]) => hasAnyOf(perms, owner, l);
  switch (tab) {
    case "sections": return any("sections");
    case "items": return any("items");
    case "exams": return any("exams.create", "exams.delete", "exams.manage");
    case "submissions": return any("exams.review");
    case "blocked": return any("exams.unblock");
    case "chats": return any("chats");
    case "announcements": return any("announcements");
    case "requests": return any("accounts.requests");
    case "members": return any("accounts.members", "staff");
    case "ranks": return any("ranks");
    case "log": return owner; // سجل الدخول للأدمن الأساسي بس
  }
}

export function visibleTabs(perms: PermInput, owner: boolean): TabId[] {
  return TAB_ORDER.filter((t) => canSeeTab(perms, owner, t));
}
