// محرر الصلاحيات الهرمي: عامة، أو على قسم/عنصر/اختبار معين، لحد الحقل الواحد.
// صلاحية الأب بتغطي كل اللي تحته، وعلامة «كل حاجة» على أي قسم/عنصر/اختبار بتغطي كل تفاصيله.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { GLOBAL_TREE, SCOPE_TREES, prefixesOf, scopedKey, type PNode, type ScopeType } from "@/lib/permissions";

export type Catalog = {
  sections: { id: string; name: string }[];
  items: { id: string; title: string; section_id: string }[];
  exams: { id: string; title: string }[];
  chats?: { id: string; name: string }[];
  announcements?: { id: string; title: string }[];
};

type Ctx = {
  set: Set<string>;
  change: (next: string[]) => void;
  value: string[];
  allowed: (key: string) => boolean;
  open: Set<string>;
  toggleOpen: (id: string) => void;
};

function descendantKeys(node: PNode): string[] {
  return (node.children ?? []).flatMap((c) => [c.key, ...descendantKeys(c)]);
}

/** الاختيار ده متغطي من أب/قسم/"كل حاجة"؟ */
function isImplied(ctx: Ctx, node: PNode, suffix: string, impliers: string[], wildcards: string[]): boolean {
  for (const sx of impliers) {
    for (const p of prefixesOf(node.key)) {
      if (sx === suffix && p === node.key) continue;
      if (ctx.set.has(p + sx)) return true;
    }
  }
  return wildcards.some((w) => ctx.set.has(`*${w}`));
}

function Check({
  checked, implied, indeterminate, disabled, onChange,
}: { checked: boolean; implied: boolean; indeterminate: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      className="mt-0.5 shrink-0"
      checked={checked || implied}
      disabled={disabled || implied}
      ref={(el) => { if (el) el.indeterminate = indeterminate && !checked && !implied; }}
      onChange={onChange}
      style={implied ? { opacity: 0.5 } : undefined}
    />
  );
}

function TreeNode({
  node, depth, suffix, impliers, wildcards, ctx,
}: { node: PNode; depth: number; suffix: string; impliers: string[]; wildcards: string[]; ctx: Ctx }) {
  const key = node.key + suffix;
  const selected = ctx.set.has(key);
  const implied = !selected && isImplied(ctx, node, suffix, impliers, wildcards);
  const desc = useMemo(() => descendantKeys(node), [node]);
  const selectedBelow = desc.filter((k) => ctx.set.has(k + suffix)).length;
  const hasChildren = !!node.children?.length;
  const id = `${suffix}|${node.key}`;
  const isOpen = ctx.open.has(id);
  const locked = !selected && !ctx.allowed(key);

  const toggle = () => {
    if (selected) ctx.change(ctx.value.filter((k) => k !== key));
    else ctx.change([...ctx.value.filter((k) => !desc.some((d) => d + suffix === k)), key]); // الأب بيغطي أولاده فبنشيل الفرعي
  };

  return (
    <div>
      <div className={`flex items-start gap-2 py-1 text-sm ${locked ? "opacity-40" : ""}`} style={{ paddingRight: depth * 18 }}>
        {hasChildren ? (
          <button type="button" onClick={() => ctx.toggleOpen(id)} className="mt-0.5 text-muted-foreground hover:text-[var(--gold)] shrink-0">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        ) : <span className="w-4 shrink-0" />}
        <Check checked={selected} implied={implied} indeterminate={selectedBelow > 0} disabled={locked} onChange={toggle} />
        <span className="flex-1 cursor-default" onClick={() => hasChildren && ctx.toggleOpen(id)}>
          {node.label}
          {!selected && !implied && selectedBelow > 0 && <span className="mr-2 text-xs text-[var(--gold)]">({selectedBelow} محدد)</span>}
          {implied && <span className="mr-2 text-xs text-muted-foreground">(متغطّي)</span>}
          {selected && hasChildren && <span className="mr-2 text-xs text-[var(--gold)]">(كل التفاصيل)</span>}
        </span>
      </div>
      {hasChildren && isOpen && node.children!.map((c) => (
        <TreeNode key={c.key} node={c} depth={depth + 1} suffix={suffix} impliers={impliers} wildcards={wildcards} ctx={ctx} />
      ))}
    </div>
  );
}

function ScopeBlock({
  type, id, name, parents, ctx, children,
}: {
  type: ScopeType; id: string; name: string;
  /** القسم/العنصر الأب (عشان صلاحياته بتغطي اللي تحته) */
  parents: { type: ScopeType; id: string }[];
  ctx: Ctx;
  children?: React.ReactNode;
}) {
  const suffix = `@${type}:${id}`;
  const parentSuffixes = parents.map((p) => `@${p.type}:${p.id}`);
  const impliers = [suffix, ...parentSuffixes, ""];
  const wildcardKeyStr = `*${suffix}`;
  const selected = ctx.set.has(wildcardKeyStr);
  const impliedMaster = !selected && parentSuffixes.some((sx) => ctx.set.has(`*${sx}`));
  const count = ctx.value.filter((k) => k.endsWith(suffix)).length;
  const blockId = `block|${suffix}`;
  const isOpen = ctx.open.has(blockId);
  const locked = !selected && !ctx.allowed(wildcardKeyStr);
  const masterOn = selected || impliedMaster;

  const toggleMaster = () => {
    if (selected) ctx.change(ctx.value.filter((k) => k !== wildcardKeyStr));
    else ctx.change([...ctx.value.filter((k) => !k.endsWith(suffix)), wildcardKeyStr]);
  };

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 p-2.5">
        <button type="button" onClick={() => ctx.toggleOpen(blockId)} className="text-muted-foreground hover:text-[var(--gold)]">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <span className="flex-1 text-sm font-semibold cursor-pointer" onClick={() => ctx.toggleOpen(blockId)}>
          {name}
          {count > 0 && !masterOn && <span className="mr-2 text-xs text-[var(--gold)]">({count} صلاحية)</span>}
        </span>
        <label className={`flex items-center gap-1.5 text-xs ${locked ? "opacity-40" : ""}`}>
          <input type="checkbox" checked={masterOn} disabled={locked || impliedMaster} onChange={toggleMaster} />
          كل حاجة
        </label>
      </div>
      {isOpen && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2 space-y-1">
          {masterOn && <div className="text-xs text-[var(--gold)] mb-1">«كل حاجة» مفعّلة، يعني كل التفاصيل متاحة (من غير ما تحتاج تحدد حاجة).</div>}
          {SCOPE_TREES[type].nodes.map((n) => (
            <TreeNode key={n.key} node={n} depth={0} suffix={suffix} impliers={impliers} wildcards={[suffix, ...parentSuffixes]} ctx={ctx} />
          ))}
          {children}
        </div>
      )}
    </div>
  );
}

export function PermissionEditor({
  value, onChange, catalog, allowed,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  catalog: Catalog | undefined;
  /** لو متحدد: الصلاحيات اللي مش مسموحله يدّيها بتتقفل */
  allowed?: (key: string) => boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const ctx: Ctx = {
    set: useMemo(() => new Set(value), [value]),
    value,
    change: onChange,
    allowed: allowed ?? (() => true),
    open,
    toggleOpen: (id) => setOpen((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
  };

  const sectionItems = (sid: string) => catalog?.items.filter((i) => i.section_id === sid) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="font-bold mb-1">صلاحيات عامة</div>
        <div className="text-xs text-muted-foreground mb-2">بتتطبق على كل حاجة من النوع ده. افتح السهم عشان تختار تفاصيل أدق.</div>
        <div className="rounded-lg border border-border p-3">
          {GLOBAL_TREE.map((n) => (
            <TreeNode key={n.key} node={n} depth={0} suffix="" impliers={[""]} wildcards={[]} ctx={ctx} />
          ))}
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">أقسام وعناصر معينة</div>
        <div className="text-xs text-muted-foreground mb-2">فعّل «كل حاجة» للقسم كله، أو افتحه وحدد التفاصيل (بيانات القسم، العناصر، وكل عنصر لحد الحقل).</div>
        <div className="space-y-2">
          {!catalog && <div className="text-sm text-muted-foreground">جارٍ التحميل...</div>}
          {catalog?.sections.map((s) => (
            <ScopeBlock key={s.id} type="section" id={s.id} name={s.name} parents={[]} ctx={ctx}>
              {sectionItems(s.id).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/60">
                  <div className="text-xs text-muted-foreground mb-2">عناصر القسم (صلاحية على عنصر واحد)</div>
                  <div className="space-y-2">
                    {sectionItems(s.id).map((i) => (
                      <ScopeBlock key={i.id} type="item" id={i.id} name={i.title} parents={[{ type: "section", id: s.id }]} ctx={ctx} />
                    ))}
                  </div>
                </div>
              )}
            </ScopeBlock>
          ))}
          {catalog && catalog.sections.length === 0 && <div className="text-sm text-muted-foreground">مفيش أقسام.</div>}
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">دردشات معينة</div>
        <div className="text-xs text-muted-foreground mb-2">الإشراف على دردشة بعينها (حذف رسايل، مسح، تعديل). فتح الدردشة نفسها بيتحدد برتبتها، مش من هنا.</div>
        <div className="space-y-2">
          {catalog?.chats?.map((c) => (
            <ScopeBlock key={c.id} type="chat" id={c.id} name={c.name} parents={[]} ctx={ctx} />
          ))}
          {catalog && (catalog.chats?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">مفيش دردشات.</div>}
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">إعلانات معينة</div>
        <div className="space-y-2">
          {catalog?.announcements?.map((a) => (
            <ScopeBlock key={a.id} type="announcement" id={a.id} name={a.title} parents={[]} ctx={ctx} />
          ))}
          {catalog && (catalog.announcements?.length ?? 0) === 0 && <div className="text-sm text-muted-foreground">مفيش إعلانات.</div>}
        </div>
      </div>

      <div>
        <div className="font-bold mb-1">اختبارات معينة</div>
        <div className="space-y-2">
          {catalog?.exams.map((e) => (
            <ScopeBlock key={e.id} type="exam" id={e.id} name={e.title} parents={[]} ctx={ctx} />
          ))}
          {catalog && catalog.exams.length === 0 && <div className="text-sm text-muted-foreground">مفيش اختبارات.</div>}
        </div>
      </div>
    </div>
  );
}

// مساعدة للاستخدام الخارجي
export { scopedKey };
