// لوحة تحكم الحسابات: طلبات الحسابات + الأعضاء + الرتب + السجل.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check, X, Plus, Trash2, Edit3, Save, Search, ShieldCheck, KeyRound, Ban, RotateCcw, UserCog, Eye, EyeOff, ChevronDown, ChevronUp, LogIn,
} from "lucide-react";
import {
  requestsListFn, approveRequestFn, rejectRequestFn, pendingRequestsCountFn,
  membersListFn, setMemberStatusFn, resetMemberPasswordFn, deleteMemberFn, updateMemberDetailsFn, assignMemberFn, setMemberHiddenFn,
  ranksListFn, saveRankFn, deleteRankFn, reorderRanksFn, permCatalogFn, auditListFn, loginLogFn,
  type MemberRow, type RankRow,
} from "@/lib/account-fns";
import { covers } from "@/lib/permissions";
import { useMe } from "@/lib/use-me";
import { Field, Modal } from "@/components/admin-ui";
import { PermissionEditor } from "@/components/PermissionEditor";
import { Avatar } from "@/components/Avatar";

const fmt = (iso: string) => new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

const catalogQuery = { queryKey: ["perm-catalog"], queryFn: () => permCatalogFn() };
const ranksQuery = { queryKey: ["admin-ranks"], queryFn: () => ranksListFn() };

export function usePendingRequestsCount() {
  const { data = 0 } = useQuery({
    queryKey: ["pending-requests-count"],
    queryFn: () => pendingRequestsCountFn(),
    refetchInterval: 10_000,
  });
  return data;
}

function useAllowed() {
  const { me } = useMe();
  return (key: string) => !!me && covers(me.perms, me.full, key);
}

// ============================== طلبات الحسابات ==============================

export function RequestsAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const allowed = useAllowed();
  const { data: rows = [], refetch } = useQuery({ queryKey: ["admin-requests"], queryFn: () => requestsListFn(), refetchInterval: 10_000 });
  const { data: ranks = [] } = useQuery({ ...ranksQuery, enabled: can("staff.rank") });
  const [approving, setApproving] = useState<{ id: string; rank_requested: string } | null>(null);
  const [rankIds, setRankIds] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const pending = rows.filter((r) => r.status === "pending");
  const rejected = rows.filter((r) => r.status === "rejected");
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["pending-requests-count"] }); qc.invalidateQueries({ queryKey: ["admin-members"] }); };

  const openApprove = (r: { id: string; rank_requested: string }) => {
    const match = ranks.find((k) => k.name.trim().toLowerCase() === r.rank_requested.trim().toLowerCase());
    setRankIds(match ? [match.id] : []);
    setApproving(r);
  };

  const approve = async () => {
    if (!approving) return;
    try { await approveRequestFn({ data: { id: approving.id, rankIds } }); }
    catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم قبول الطلب"); setApproving(null); refresh();
  };
  const reject = async () => {
    if (!rejecting) return;
    try { await rejectRequestFn({ data: { id: rejecting, reason } }); }
    catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم رفض الطلب"); setRejecting(null); setReason(""); refresh();
  };

  return (
    <div>
      <div className="grid gap-3">
        {pending.map((r) => (
          <div key={r.id} className="mil-card p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-64 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">اسم الحساب: </span><b>{r.account_name}</b></div>
                <div><span className="text-muted-foreground">اسم الشخصية: </span><b>{r.character_name}</b></div>
                <div><span className="text-muted-foreground">الكود العسكري: </span><b>{r.military_code}</b></div>
                <div><span className="text-muted-foreground">الرتبة المكتوبة: </span><b>{r.rank_requested}</b></div>
                <div className="col-span-2" dir="ltr" style={{ textAlign: "right" }}><span className="text-muted-foreground" dir="rtl">الإيميل: </span><b>{r.email}</b></div>
                <div className="col-span-2 text-xs text-muted-foreground">اتبعت {fmt(r.created_at)}</div>
              </div>
              <div className="flex gap-2">
                {can("accounts.requests.approve") && <button onClick={() => openApprove(r)} className="px-3 py-1.5 rounded-md border border-[var(--gold)] text-[var(--gold)] text-sm inline-flex items-center gap-2"><Check className="h-4 w-4" />قبول</button>}
                {can("accounts.requests.reject") && <button onClick={() => { setRejecting(r.id); setReason(""); }} className="px-3 py-1.5 rounded-md border border-border hover:border-destructive hover:text-destructive text-sm inline-flex items-center gap-2"><X className="h-4 w-4" />رفض</button>}
              </div>
            </div>
          </div>
        ))}
        {pending.length === 0 && <div className="text-center text-muted-foreground py-12">مفيش طلبات جديدة.</div>}
      </div>

      {rejected.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowHistory(!showHistory)} className="text-sm text-muted-foreground hover:text-[var(--gold)]">
            {showHistory ? "إخفاء" : "عرض"} الطلبات المرفوضة ({rejected.length})
          </button>
          {showHistory && (
            <div className="grid gap-2 mt-3">
              {rejected.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
                  <b className="text-foreground">{r.account_name}</b> • {r.character_name} • {r.military_code} • <span dir="ltr">{r.email}</span>
                  {r.reject_reason && <div className="mt-1">السبب: {r.reject_reason}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {approving && (
        <Modal onClose={() => setApproving(null)} title="قبول الطلب">
          <p className="text-sm text-muted-foreground mb-4">الحساب هيتفعّل ويقدر يدخل. الرتب هي اللي بتحدد صلاحياته (اختيارية، وتقدر تدّيه أكتر من رتبة).</p>
          {can("staff.rank") ? (
            <Field label={`الرتب (هو كتب: ${approving.rank_requested})`}>
              <div className="grid gap-1 max-h-56 overflow-y-auto rounded-lg border border-border p-2">
                {ranks.map((k) => {
                  const ok = k.permissions.every(allowed);
                  return (
                    <label key={k.id} className={`flex items-center gap-2 text-sm ${ok ? "" : "opacity-40"}`}>
                      <input type="checkbox" disabled={!ok} checked={rankIds.includes(k.id)} onChange={() => setRankIds(rankIds.includes(k.id) ? rankIds.filter((x) => x !== k.id) : [...rankIds, k.id])} />
                      {k.name}{ok ? "" : " (أكبر من صلاحياتك)"}
                    </label>
                  );
                })}
                {ranks.length === 0 && <div className="text-sm text-muted-foreground">مفيش رتب لسه.</div>}
              </div>
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground mb-4">هيتفعّل كحساب عادي. إعطاء الرتب محتاج صلاحية «إعطاء وسحب الرتب».</p>
          )}
          <button onClick={approve} className="btn-gold ripple inline-flex items-center gap-2"><Check className="h-4 w-4" />تأكيد القبول</button>
        </Modal>
      )}

      {rejecting && (
        <Modal onClose={() => setRejecting(null)} title="رفض الطلب">
          <Field label="سبب الرفض (اختياري — بيظهر للشخص لما يحاول يدخل)">
            <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button onClick={reject} className="btn-gold ripple inline-flex items-center gap-2"><X className="h-4 w-4" />تأكيد الرفض</button>
        </Modal>
      )}
    </div>
  );
}

// ============================== الأعضاء ==============================

type AssignDraft = MemberRow & { _grants: string[]; _denies: string[]; _ranks: string[] };

export function MembersAdmin() {
  const qc = useQueryClient();
  const { can, me } = useMe();
  const allowed = useAllowed();
  const { data: members = [], refetch } = useQuery({ queryKey: ["admin-members"], queryFn: () => membersListFn() });
  const { data: ranks = [] } = useQuery({ ...ranksQuery });
  const { data: catalog } = useQuery({ ...catalogQuery, enabled: can("staff.grant") });
  const [search, setSearch] = useState("");
  const [details, setDetails] = useState<MemberRow | null>(null);
  const [assign, setAssign] = useState<AssignDraft | null>(null);
  const [pw, setPw] = useState<{ id: string; name: string; value: string } | null>(null);

  const canRank = can("staff.rank");
  const canGrant = can("staff.grant");
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-ranks"] }); };
  const q = search.trim().toLowerCase();
  const list = members.filter((m) => !q || [m.account_name, m.character_name, m.military_code, m.email, ...m.rank_names].some((v) => v.toLowerCase().includes(q)));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success(ok); refresh();
  };

  return (
    <div>
      <div className="relative max-w-md mb-6">
        <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input className="input pr-9" placeholder="بحث بالاسم أو الكود أو الإيميل أو الرتبة" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-3">
        {list.map((m) => (
          <div key={m.id} className={`mil-card p-4 ${m.status === "disabled" ? "opacity-60" : ""} ${m.hidden ? "border-dashed" : ""}`}>
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={m.is_owner ? (m.display_title || "الأدمن الأساسي") : m.account_name} src={m.avatar} size={44} />
              <div className="flex-1 min-w-64">
                <div className="font-bold flex items-center gap-2 flex-wrap">
                  {m.is_owner ? (m.display_title || "الأدمن الأساسي") : m.account_name}
                  {m.is_owner && <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--gold)] text-[var(--gold)]">صاحب الموقع</span>}
                  {m.rank_names.map((n) => <span key={n} className="text-xs px-2 py-0.5 rounded-full bg-[var(--gold)]/15 text-[var(--gold)]">{n}</span>)}
                  {m.status === "disabled" && <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">موقوف</span>}
                  {m.hidden && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">مخفي — إنت بس اللي شايفه</span>}
                  {m.grants.length > 0 && <span className="text-xs text-muted-foreground">+{m.grants.length} صلاحية فردية</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {!m.is_owner && <>{m.character_name} • {m.military_code} • </>}<span dir="ltr">{m.email}</span>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {me?.full && !m.is_owner && (
                  <button title={m.hidden ? "إظهار في قايمة الأعضاء" : "إخفاء من قايمة الأعضاء"} onClick={() => run(() => setMemberHiddenFn({ data: { id: m.id, hidden: !m.hidden } }), m.hidden ? "ظهر في القايمة" : "اتخفى من القايمة")} className="p-2 hover:text-[var(--gold)]">
                    {m.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                )}
                {m.manageable && (
                  <>
                    {(canRank || canGrant) && (
                      <button title="الرتب والصلاحيات" onClick={() => setAssign({ ...m, _grants: m.grants, _denies: m.denies, _ranks: m.rank_ids })} className="p-2 hover:text-[var(--gold)]"><ShieldCheck className="h-4 w-4" /></button>
                    )}
                    {can("accounts.members.edit") && <button title="تعديل البيانات" onClick={() => setDetails(m)} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
                    {can("accounts.members.password") && <button title="كلمة سر جديدة" onClick={() => setPw({ id: m.id, name: m.account_name, value: "" })} className="p-2 hover:text-[var(--gold)]"><KeyRound className="h-4 w-4" /></button>}
                    {can("accounts.members.disable") && (
                      <button title={m.status === "active" ? "إيقاف الحساب" : "تفعيل الحساب"} onClick={() => run(() => setMemberStatusFn({ data: { id: m.id, status: m.status === "active" ? "disabled" : "active" } }), m.status === "active" ? "تم الإيقاف" : "تم التفعيل")} className="p-2 hover:text-[var(--gold)]">
                        {m.status === "active" ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      </button>
                    )}
                    {can("accounts.members.delete") && <button title="حذف الحساب" onClick={() => { if (confirm(`حذف حساب ${m.account_name} نهائيًا؟`)) run(() => deleteMemberFn({ data: m.id }), "تم الحذف"); }} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-muted-foreground py-12">مفيش نتايج.</div>}
      </div>

      {details && (
        <Modal onClose={() => setDetails(null)} title="تعديل بيانات الحساب">
          <Field label="اسم الحساب"><input className="input" value={details.account_name} onChange={(e) => setDetails({ ...details, account_name: e.target.value })} /></Field>
          <Field label="اسم الشخصية"><input className="input" value={details.character_name} onChange={(e) => setDetails({ ...details, character_name: e.target.value })} /></Field>
          <Field label="الكود العسكري"><input className="input" value={details.military_code} onChange={(e) => setDetails({ ...details, military_code: e.target.value })} /></Field>
          <button className="btn-gold ripple inline-flex items-center gap-2" onClick={async () => {
            await run(() => updateMemberDetailsFn({ data: { id: details.id, account_name: details.account_name, character_name: details.character_name, military_code: details.military_code } }), "تم الحفظ");
            setDetails(null);
          }}><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}

      {pw && (
        <Modal onClose={() => setPw(null)} title={`كلمة سر جديدة — ${pw.name}`}>
          <Field label="كلمة المرور الجديدة (6 أحرف على الأقل)">
            <input className="input" dir="ltr" value={pw.value} onChange={(e) => setPw({ ...pw, value: e.target.value })} />
          </Field>
          <button className="btn-gold ripple inline-flex items-center gap-2" onClick={async () => {
            await run(() => resetMemberPasswordFn({ data: { id: pw.id, password: pw.value } }), "تم تغيير كلمة المرور");
            setPw(null);
          }}><KeyRound className="h-4 w-4" />تغيير</button>
        </Modal>
      )}

      {assign && (
        <Modal onClose={() => setAssign(null)} title={`الرتب والصلاحيات — ${assign.account_name}`} wide>
          <Field label="الرتب (ممكن أكتر من رتبة، والصلاحيات بتتجمّع)" hint={canRank ? undefined : "مفيش عندك صلاحية تغيير الرتب."}>
            <div className="grid gap-1 rounded-lg border border-border p-2 max-h-56 overflow-y-auto">
              {ranks.map((k) => {
                const ok = canRank && k.permissions.every(allowed);
                return (
                  <label key={k.id} className={`flex items-center gap-2 text-sm ${ok || assign._ranks.includes(k.id) ? "" : "opacity-40"}`}>
                    <input type="checkbox" disabled={!ok} checked={assign._ranks.includes(k.id)} onChange={() => setAssign({ ...assign, _ranks: assign._ranks.includes(k.id) ? assign._ranks.filter((x) => x !== k.id) : [...assign._ranks, k.id] })} />
                    {k.name}<span className="text-xs text-muted-foreground">({k.permissions.length} صلاحية)</span>{canRank && !k.permissions.every(allowed) ? " — أكبر من صلاحياتك" : ""}
                  </label>
                );
              })}
              {ranks.length === 0 && <div className="text-sm text-muted-foreground">مفيش رتب لسه.</div>}
            </div>
          </Field>
          <div className="mb-6">
            <div className="font-bold mb-1">صلاحيات إضافية للشخص ده بس</div>
            <PermissionEditor value={assign._grants} onChange={(v) => setAssign({ ...assign, _grants: v })} catalog={catalog} allowed={(k) => canGrant && allowed(k)} />
          </div>
          <details className="mb-6">
            <summary className="cursor-pointer font-bold">صلاحيات ممنوعة عنه رغم رتبه (اختياري)</summary>
            <div className="mt-3"><PermissionEditor value={assign._denies} onChange={(v) => setAssign({ ...assign, _denies: v })} catalog={catalog} allowed={() => canGrant} /></div>
          </details>
          <button className="btn-gold ripple inline-flex items-center gap-2" onClick={async () => {
            await run(() => assignMemberFn({ data: { id: assign.id, rank_ids: assign._ranks, grants: assign._grants, denies: assign._denies } }), "تم الحفظ");
            setAssign(null);
          }}><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}

// ============================== الرتب ==============================

export function RanksAdmin() {
  const qc = useQueryClient();
  const { can } = useMe();
  const allowed = useAllowed();
  const { data: ranks = [], refetch } = useQuery(ranksQuery);
  const { data: catalog } = useQuery(catalogQuery);
  const [editing, setEditing] = useState<{ id?: string; name: string; permissions: string[] } | null>(null);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ["admin-members"] }); qc.invalidateQueries({ queryKey: ["me"] }); };

  const save = async () => {
    if (!editing?.name.trim()) return toast.error("اسم الرتبة مطلوب");
    try { await saveRankFn({ data: { id: editing.id, name: editing.name, permissions: editing.permissions } }); }
    catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحفظ — والتعديل اتطبق على كل اللي معاهم الرتبة"); setEditing(null); refresh();
  };
  // نقل رتبة لفوق/لتحت — الأعلى هي اللي بتظهر جنب اسم الشخص لو معاه أكتر من رتبة
  const move = async (index: number, dir: -1 | 1) => {
    const ids = ranks.map((r) => r.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try { await reorderRanksFn({ data: ids }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    refresh();
  };
  const del = async (r: RankRow) => {
    if (!confirm(`حذف الرتبة «${r.name}»؟ ${r.members ? `${r.members} عضو هيفقدوها.` : ""}`)) return;
    try { await deleteRankFn({ data: r.id }); } catch (e: any) { return toast.error(e.message || "حدث خطأ"); }
    toast.success("تم الحذف"); refresh();
  };

  return (
    <div>
      {can("ranks.create") && <button onClick={() => setEditing({ name: "", permissions: [] })} className="btn-gold ripple mb-6 inline-flex items-center gap-2"><Plus className="h-4 w-4" />رتبة جديدة</button>}
      {ranks.length > 1 && (
        <div className="text-xs text-muted-foreground mb-4">
          الترتيب من فوق لتحت حسب الأولوية: لو شخص معاه أكتر من رتبة، <b className="text-foreground">الأعلى</b> هي اللي بتظهر جنب اسمه في الدردشة، وبتتقدّم في قوايم الأعضاء.
        </div>
      )}
      <div className="grid gap-3">
        {ranks.map((r, i) => (
          <div key={r.id} className="mil-card p-4 flex items-center gap-4">
            {can("ranks.reorder") ? (
              <div className="flex flex-col -my-1">
                <button title="لفوق" disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 text-muted-foreground hover:text-[var(--gold)] disabled:opacity-20"><ChevronUp className="h-4 w-4" /></button>
                <button title="لتحت" disabled={i === ranks.length - 1} onClick={() => move(i, 1)} className="p-0.5 text-muted-foreground hover:text-[var(--gold)] disabled:opacity-20"><ChevronDown className="h-4 w-4" /></button>
              </div>
            ) : null}
            <div className="w-6 text-center text-sm font-bold text-[var(--gold)]">{i + 1}</div>
            <UserCog className="h-5 w-5 text-[var(--gold)]" />
            <div className="flex-1">
              <div className="font-bold">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.permissions.length} صلاحية • {r.members} عضو</div>
            </div>
            {can("ranks.edit") && <button onClick={() => setEditing({ id: r.id, name: r.name, permissions: r.permissions })} className="p-2 hover:text-[var(--gold)]"><Edit3 className="h-4 w-4" /></button>}
            {can("ranks.delete") && <button onClick={() => del(r)} className="p-2 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {ranks.length === 0 && <div className="text-center text-muted-foreground py-12">لسه مفيش رتب. اعمل أول رتبة وحدد صلاحياتها.</div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title={editing.id ? "تعديل رتبة" : "رتبة جديدة"} wide>
          <Field label="اسم الرتبة"><input className="input" value={editing.name} maxLength={60} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
          <PermissionEditor value={editing.permissions} onChange={(v) => setEditing({ ...editing, permissions: v })} catalog={catalog} allowed={allowed} />
          <button onClick={save} className="btn-gold ripple mt-6 inline-flex items-center gap-2"><Save className="h-4 w-4" />حفظ</button>
        </Modal>
      )}
    </div>
  );
}

// ============================== السجل (الأدمن الأساسي) ==============================

const CATEGORY_LABELS: Record<string, string> = {
  sections: "الأقسام", items: "العناصر", topics: "المواضيع", uploads: "رفع ملفات", exams: "الاختبارات", questions: "الأسئلة",
  attempts: "التسليمات والمحظورين", accounts: "الحسابات", ranks: "الرتب", staff: "الصلاحيات", settings: "إعدادات الأدمن", chats: "الدردشات", announcements: "الإعلانات",
};
const REASON_LABELS: Record<string, string> = {
  ok: "تم الدخول", wrong_password: "كلمة سر غلط", unknown: "حساب مش موجود", pending: "طلب معلّق", rejected: "طلب مرفوض", disabled: "حساب موقوف",
};

export function LogAdmin() {
  const [mode, setMode] = useState<"admin" | "login">("admin");
  return (
    <div>
      <div className="flex gap-2 mb-6">
        {([["admin", "نشاط الإدارة"], ["login", "تسجيلات الدخول"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)} className={`px-4 py-2 rounded-lg text-sm border transition ${mode === k ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10" : "border-border text-muted-foreground hover:text-foreground"}`}>{label}</button>
        ))}
      </div>
      {mode === "admin" ? <AdminActivityLog /> : <LoginLog />}
    </div>
  );
}

function AdminActivityLog() {
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["audit-log", category, search, limit],
    queryFn: () => auditListFn({ data: { category: category || undefined, search, limit, offset: 0 } }),
    refetchInterval: 15_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input pr-9" placeholder="بحث بالاسم أو الملخص" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input max-w-52" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="grid gap-2">
        {entries.map((e) => {
          const isOpen = openId === e.id;
          return (
            <div key={e.id} className="mil-card">
              <button onClick={() => setOpenId(isOpen ? null : e.id)} className="w-full flex items-center gap-3 p-3 text-right">
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : "-rotate-90"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <b>{e.actor_name}</b>
                    {e.actor_rank && <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--gold)]/15 text-[var(--gold)]">{e.actor_rank}</span>}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">{CATEGORY_LABELS[e.category] ?? e.category}</span>
                  </div>
                  <div className="text-sm mt-1 truncate">{e.summary}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{fmt(e.at)}</div>
              </button>
              {isOpen && (
                <div className="border-t border-border px-4 py-3 text-sm space-y-3">
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
                    <div><span className="text-muted-foreground">اللي عمل: </span>{e.actor_name} <span dir="ltr" className="text-xs text-muted-foreground">({e.actor_email})</span></div>
                    {e.target && <div><span className="text-muted-foreground">على: </span>{e.target}</div>}
                    <div><span className="text-muted-foreground">الوقت: </span>{new Date(e.at).toLocaleString("ar-EG")}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr" style={{ textAlign: "right" }}>{e.action}</div>
                  </div>
                  {e.changes.length > 0 && (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <div className="grid grid-cols-[1fr_1fr_1fr] bg-white/5 text-xs text-muted-foreground px-3 py-2"><div>الحقل</div><div>قبل</div><div>بعد</div></div>
                      {e.changes.map((c, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 border-t border-border/60 text-sm">
                          <div className="font-semibold">{c.label}</div>
                          <div className="text-muted-foreground whitespace-pre-wrap break-words">{c.before ?? "—"}</div>
                          <div className="whitespace-pre-wrap break-words">{c.after ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {e.note && <pre className="whitespace-pre-wrap text-sm bg-black/20 rounded-lg p-3 font-sans">{e.note}</pre>}
                  {e.changes.length === 0 && !e.note && <div className="text-muted-foreground">مفيش تفاصيل إضافية.</div>}
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && <div className="text-center text-muted-foreground py-12">مفيش نشاط مسجّل.</div>}
      </div>
      {data && data.total > entries.length && (
        <button onClick={() => setLimit(limit + 50)} className="mt-4 text-sm text-[var(--gold)] hover:underline">عرض المزيد ({data.total - entries.length} متبقي)</button>
      )}
    </div>
  );
}

function LoginLog() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["login-log", status, search, limit],
    queryFn: () => loginLogFn({ data: { status: status || undefined, search, limit, offset: 0 } }),
    refetchInterval: 15_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="input pr-9" placeholder="بحث بالإيميل أو الاسم أو IP" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input max-w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">الكل</option>
          <option value="ok">الناجحة</option>
          <option value="failed">الفاشلة</option>
        </select>
      </div>
      <div className="grid gap-2">
        {entries.map((e) => {
          const isOpen = openId === e.id;
          return (
            <div key={e.id} className="mil-card">
              <button onClick={() => setOpenId(isOpen ? null : e.id)} className="w-full flex items-center gap-3 p-3 text-right">
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : "-rotate-90"}`} />
                <LogIn className={`h-4 w-4 shrink-0 ${e.ok ? "text-[var(--gold)]" : "text-destructive"}`} />
                <div className="flex-1 min-w-0 text-sm">
                  <b dir="auto">{e.account_name || e.identifier}</b>
                  <span className={`mr-2 text-xs px-2 py-0.5 rounded-full ${e.ok ? "bg-[var(--gold)]/15 text-[var(--gold)]" : "bg-destructive/20 text-destructive"}`}>{REASON_LABELS[e.reason] ?? e.reason}</span>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{fmt(e.at)}</div>
              </button>
              {isOpen && (
                <div className="border-t border-border px-4 py-3 text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">
                  <div><span className="text-muted-foreground">اللي اتكتب: </span><span dir="ltr">{e.identifier}</span></div>
                  <div><span className="text-muted-foreground">الطريقة: </span>{e.method === "email" ? "إيميل" : "اسم حساب"}</div>
                  <div><span className="text-muted-foreground">النتيجة: </span>{REASON_LABELS[e.reason] ?? e.reason}</div>
                  <div><span className="text-muted-foreground">IP: </span><span dir="ltr">{e.ip ?? "—"}</span></div>
                  <div className="sm:col-span-2"><span className="text-muted-foreground">الجهاز: </span><span dir="ltr" className="text-xs break-all">{e.user_agent ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">الوقت: </span>{new Date(e.at).toLocaleString("ar-EG")}</div>
                </div>
              )}
            </div>
          );
        })}
        {entries.length === 0 && <div className="text-center text-muted-foreground py-12">مفيش تسجيلات.</div>}
      </div>
      {data && data.total > entries.length && (
        <button onClick={() => setLimit(limit + 50)} className="mt-4 text-sm text-[var(--gold)] hover:underline">عرض المزيد ({data.total - entries.length} متبقي)</button>
      )}
    </div>
  );
}
