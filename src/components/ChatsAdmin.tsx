// تاب إدارة الدردشات في لوحة التحكم.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Edit3, Save, MessageSquare, Eraser, Lock, ChevronUp, ChevronDown, X } from "lucide-react";
import { chatsAdminFn, saveChatFn, deleteChatFn, clearChatFn, chatRankOptionsFn, type ChatAdminRow } from "@/lib/chat-fns";
import { useMe } from "@/lib/use-me";
import { Field, Modal } from "@/components/admin-ui";

export function ChatsAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const { data: chats = [], refetch } = useQuery({ queryKey: ["admin-chats"], queryFn: () => chatsAdminFn() });
  const { data: ranks = [] } = useQuery({ queryKey: ["chat-rank-options"], queryFn: () => chatRankOptionsFn() });
  const [editing, setEditing] = useState<Partial<ChatAdminRow> | null>(null);

  const lk = (g: string) => !!editing?.id && !can(`chats.edit.${g}`, { chat: editing.id });
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["chats-list"] }); };

  const save = async () => {
    if (!editing) return;
    try {
      await saveChatFn({ data: { id: editing.id, name: editing.name ?? "", description: editing.description ?? "", rank_ids: editing.rank_ids ?? [], rank_display_order: editing.rank_display_order ?? [], allow_images: editing.allow_images ?? true, enabled: editing.enabled ?? true } });
    } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ"); setEditing(null); refresh();
  };
  const del = async (c: ChatAdminRow) => {
    if (!confirm(`حذف الدردشة «${c.name}» بكل رسايلها؟`)) return;
    try { await deleteChatFn({ data: c.id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };
  const clear = async (c: ChatAdminRow) => {
    if (!confirm(`مسح كل رسايل «${c.name}»؟`)) return;
    try { await clearChatFn({ data: c.id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم المسح"); refresh();
  };

  const nameOf = (id: string) => ranks.find((r) => r.id === id)?.name ?? "رتبة";

  return (
    <div>
      {can("chats.create") && (
        <button onClick={() => setEditing({ name: "", description: "", rank_ids: [], rank_display_order: [], allow_images: true, enabled: true })} className="btn-gold ripple mb-6 inline-flex items-center gap-2"><Plus className="h-4 w-4" />دردشة جديدة</button>
      )}
      <div className="grid gap-3">
        {chats.map((c) => (
          <div key={c.id} className={`mil-card p-4 flex items-center gap-4 ${c.enabled ? "" : "opacity-60"}`}>
            <MessageSquare className="h-5 w-5 text-[var(--gold)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-bold flex items-center gap-2 flex-wrap">
                {c.name}
                {!c.enabled && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">موقوفة</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {c.rank_ids.length ? `الرتب: ${c.rank_ids.map(nameOf).join("، ")}` : "من غير رتب (صاحب الموقع بس)"} • {c.messages} رسالة
              </div>
            </div>
            {c.can.clear && <button title="مسح كل الرسايل" onClick={() => clear(c)} className="p-2 hover:text-[var(--gold)]"><Eraser className="h-4 w-4" /></button>}
            {c.can.anySettings && <button title="تعديل" onClick={() => setEditing(c)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
            {c.can.delete && <button title="حذف" onClick={() => del(c)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {chats.length === 0 && <div className="text-center text-muted-foreground py-12">لسه مفيش دردشات. اعمل دردشة واربطها برتبة.</div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "تعديل دردشة" : "دردشة جديدة"}>
          <Field label="اسم الدردشة" locked={lk("name")}><input className="input" maxLength={60} value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <Field label="وصف (اختياري)" locked={lk("description")}><input className="input" maxLength={200} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          <Field label="الرتب اللي تقدر تفتح الدردشة" locked={lk("ranks")} hint="الدردشة بتظهر لكل المسجّلين بس بتتفتح لأصحاب الرتب دي بس. صاحب الموقع بيفتح كل الدردشات.">
            <div className="grid gap-1 rounded-lg border border-border p-2 max-h-56 overflow-y-auto">
              {ranks.map((r) => {
                const selected = (editing.rank_ids ?? []).includes(r.id);
                // غير صاحب الموقع مينفعش يضيف رتبة مش معاه (السيرفر بيفرض كده)
                const mine = r.mine;
                return (
                  <label key={r.id} className={`flex items-center gap-2 text-sm ${mine || selected ? "" : "opacity-40"}`}>
                    <input type="checkbox" disabled={!mine && !selected} checked={selected} onChange={() => setEditing({ ...editing, rank_ids: selected ? (editing.rank_ids ?? []).filter((x) => x !== r.id) : [...(editing.rank_ids ?? []), r.id] })} />
                    {r.name}{!mine && !selected ? " (مش معاك)" : ""}
                  </label>
                );
              })}
              {ranks.length === 0 && <div className="text-sm text-muted-foreground">مفيش رتب لسه.</div>}
            </div>
          </Field>
          {(() => {
            const order = (editing.rank_display_order ?? []).filter((id) => ranks.some((r) => r.id === id));
            const custom = (editing.rank_display_order ?? []).length > 0;
            const nameOfRank = (id: string) => ranks.find((r) => r.id === id)?.name ?? "";
            const move = (i: number, dir: -1 | 1) => {
              const next = [...order];
              const j = i + dir;
              if (j < 0 || j >= next.length) return;
              [next[i], next[j]] = [next[j], next[i]];
              setEditing({ ...editing, rank_display_order: next });
            };
            const missing = ranks.filter((r) => !order.includes(r.id));
            return (
              <Field
                label="ترتيب ظهور الرتب جنب الأسماء في الدردشة دي"
                locked={lk("display")}
                hint="لو الشخص معاه أكتر من رتبة، بتظهر جنب اسمه الأعلى في القايمة دي. الرتب اللي مش في القايمة بتيجي بعدها بالترتيب العام."
              >
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input
                    type="checkbox"
                    checked={custom}
                    onChange={(e) => setEditing({ ...editing, rank_display_order: e.target.checked ? ranks.map((r) => r.id) : [] })}
                  />
                  ترتيب مخصص للدردشة دي (بدل الترتيب العام للرتب)
                </label>
                {custom && (
                  <div className="rounded-lg border border-border p-2 grid gap-1">
                    {order.map((id, i) => (
                      <div key={id} className="flex items-center gap-2 text-sm">
                        <span className="w-5 text-center font-bold text-[var(--gold)]">{i + 1}</span>
                        <span className="flex-1">{nameOfRank(id)}</span>
                        <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 text-muted-foreground hover:text-[var(--gold)] disabled:opacity-20"><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="p-0.5 text-muted-foreground hover:text-[var(--gold)] disabled:opacity-20"><ChevronDown className="h-4 w-4" /></button>
                        <button type="button" title="شيلها من الترتيب المخصص" onClick={() => setEditing({ ...editing, rank_display_order: order.filter((x) => x !== id) })} className="p-0.5 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                    {missing.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2 mt-1 border-t border-border/60">
                        {missing.map((r) => (
                          <button key={r.id} type="button" onClick={() => setEditing({ ...editing, rank_display_order: [...order, r.id] })} className="text-xs px-2 py-1 rounded-full border border-border hover:border-[var(--gold)] hover:text-[var(--gold)]">+ {r.name}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            );
          })()}
          <label className={`flex items-center gap-2 text-sm mb-3 ${lk("images") ? "opacity-50" : ""}`}>
            <input type="checkbox" disabled={lk("images")} checked={editing.allow_images ?? true} onChange={(e) => setEditing({ ...editing, allow_images: e.target.checked })} />
            السماح بإرسال الصور في الدردشة {lk("images") && <Lock className="h-3 w-3 text-[var(--gold)]" />}
          </label>
          <label className={`flex items-center gap-2 text-sm mb-6 ${lk("status") ? "opacity-50" : ""}`}>
            <input type="checkbox" disabled={lk("status")} checked={editing.enabled ?? true} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
            الدردشة شغالة {lk("status") && <Lock className="h-3 w-3 text-[var(--gold)]" />}
          </label>
          <button onClick={save} className="btn-gold ripple inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}
