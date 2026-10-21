// Server functions الخاصة بنظام الاختبارات (الزوار + لوحة التحكم).
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestIP } from "@tanstack/react-start/server";
import * as auth from "./local-auth.server";
import * as exams from "./exams.server";
import * as access from "./access.server";
import * as audit from "./audit.server";
import { EXAM_SETTINGS_FIELDS, changedGroups, wildcardKey, type FieldGroup } from "./permissions";
import { getViewer } from "./viewer.server";
import { normBypass } from "./bypass";

async function requireActor(): Promise<access.Actor> {
  const actor = await access.actorFromUserId(await auth.verifySessionToken(getCookie(auth.SESSION_COOKIE)));
  if (!actor) throw new Error("غير مسجل الدخول");
  return actor;
}

const MASK = "••••";

function examCan(actor: access.Actor, examId: string): exams.ExamCan {
  const scope = { exam: examId };
  const settings: Record<string, boolean> = {};
  for (const g of EXAM_SETTINGS_FIELDS) settings[g.id] = access.can(actor, `exams.manage.settings.${g.id}`, scope);
  return {
    settings,
    anySettings: Object.values(settings).some(Boolean),
    questions: {
      view: access.can(actor, "exams.manage.questions.view", scope),
      add: access.can(actor, "exams.manage.questions.add", scope),
      edit: access.can(actor, "exams.manage.questions.edit", scope),
      delete: access.can(actor, "exams.manage.questions.delete", scope),
    },
    review: { view: access.can(actor, "exams.review.view", scope), grade: access.can(actor, "exams.review.grade", scope), delete: access.can(actor, "exams.review.delete", scope) },
    unblock: access.can(actor, "exams.unblock", scope),
    delete: access.can(actor, "exams.delete", scope),
  };
}

function assertExams(actor: access.Actor, perm: string, examIds: string[]) {
  for (const id of examIds) access.assertCan(actor, perm, { exam: id });
}

function clientWho(): string {
  try { return getRequestIP({ xForwardedFor: true }) ?? "unknown"; } catch { return "unknown"; }
}

// ==================== الزوار ====================

export const publicExamsFn = createServerFn({ method: "GET" }).handler(async () => exams.listPublicExams(await getViewer()));

export const publicExamFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; token?: string | null }) => d)
  .handler(async ({ data }) => exams.getPublicExam(data.id, data.token, await getViewer()));

export const unlockExamFn = createServerFn({ method: "POST" })
  .validator((d: { examId: string; password: string }) => d)
  .handler(async ({ data }) => exams.unlockExam(data.examId, data.password, clientWho()));

export const unlockByPasswordFn = createServerFn({ method: "POST" })
  .validator((d: { password: string }) => d)
  .handler(async ({ data }) => exams.unlockByPassword(data.password, clientWho()));

// الاختبارات للمسجّلين بس — بيانات الطالب بتتاخد من حسابه على السيرفر.
const examUser = (a: access.Actor): exams.ExamUser => ({ id: a.user.id, account_name: a.user.account_name, character_name: a.user.character_name });

export const startExamFn = createServerFn({ method: "POST" })
  .validator((d: { examId: string; access?: string | null }) => d)
  .handler(async ({ data }) => exams.startExam(data.examId, examUser(await requireActor()), data.access));

export const pollExamFn = createServerFn({ method: "POST" })
  .validator((d: { examId: string; access?: string | null }) => d)
  .handler(async ({ data }) => exams.pollExamState(data.examId, examUser(await requireActor()), data.access));

export const myExamResultsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  return exams.myResults(actor.user.id);
});

export const saveAnswersFn = createServerFn({ method: "POST" })
  .validator((d: { attemptId: string; token: string; answers: Record<string, string>; final?: boolean }) => d)
  .handler(async ({ data }) => exams.saveAnswers(data.attemptId, data.token, data.answers, !!data.final));

export const reportLeaveFn = createServerFn({ method: "POST" })
  .validator((d: { attemptId: string; token: string; reason: exams.BlockReason; answers?: Record<string, string> }) => d)
  .handler(async ({ data }) => exams.reportLeave(data.attemptId, data.token, data.reason, data.answers));

// ==================== لوحة التحكم ====================
// كل دالة بتفحص الصلاحية على السيرفر (عامة أو على الاختبار المحدد، وحتى مستوى الحقل).

const QUESTION_FIELDS: FieldGroup[] = [
  { id: "text", label: "نص السؤال", fields: ["text"] },
  { id: "kind", label: "النوع (أساسي/اختياري)", fields: ["kind"] },
  { id: "type", label: "شكل الإجابة", fields: ["type"] },
  { id: "options", label: "الاختيارات", fields: ["options"] },
  { id: "image_mode", label: "صورة في الإجابة", fields: ["image_mode"] },
  { id: "max_images", label: "أقصى عدد صور", fields: ["max_images"] },
  { id: "model_answer", label: "الإجابة النموذجية", fields: ["model_answer"] },
  { id: "points", label: "درجة السؤال", fields: ["points"] },
  { id: "correct_answer", label: "الإجابة الصح (للتصحيح التلقائي)", fields: ["correct_answer"] },
];

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t);

export const adminExamsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  const list = await exams.adminListExams();
  return list
    .filter((e) => actor.owner || access.canAnyAt(actor, "exams", { exam: e.id }))
    .map((e) => {
      const can = examCan(actor, e.id);
      // كلمة سر الاختبار مبتظهرش غير لمن يقدر يعدّل نوع الاختبار
      return { ...e, password: can.settings.access ? e.password : e.password ? MASK : null, can };
    });
});

export const adminSaveExamFn = createServerFn({ method: "POST" })
  .validator((d: Partial<exams.Exam>) => d)
  .handler(async ({ data: raw }) => {
    const actor = await requireActor();
    const data = { ...raw };
    if (data.password === MASK) delete data.password; // كلمة سر مقنّعة = مفيش تغيير
    if ("bypass" in data) data.bypass = normBypass(data.bypass);
    if (data.id) {
      const existing = await exams.adminGetExam(data.id);
      if (!existing) throw new Error("الاختبار غير موجود");
      const groups = changedGroups(EXAM_SETTINGS_FIELDS, existing, data);
      if (groups.length === 0) return existing;
      access.assertCanGroups(actor, "exams.manage.settings", groups, { exam: existing.id });
      const patch: Record<string, unknown> = {};
      for (const g of groups) for (const f of g.fields) if (f in data) patch[f] = (data as Record<string, unknown>)[f];
      const saved = await exams.adminSaveExam({ ...existing, ...patch } as Partial<exams.Exam>);
      await audit.logAdmin(actor, {
        category: "exams", action: "exam.update", summary: `عدّل إعدادات الاختبار «${existing.title}»`,
        target: existing.title, changes: audit.buildChanges(groups, existing, patch),
      });
      return saved;
    }
    access.assertCan(actor, "exams.create");
    const created = await exams.adminSaveExam(data);
    if (!actor.owner) await auth.addGrants(actor.user.id, [wildcardKey("exam", created.id)]); // اللي عمل الاختبار يديره
    await audit.logAdmin(actor, { category: "exams", action: "exam.create", summary: `أنشأ اختبار «${created.title}»`, target: created.title });
    return created;
  });

export const adminDeleteExamFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    access.assertCan(actor, "exams.delete", { exam: id });
    const existing = await exams.adminGetExam(id);
    await exams.adminDeleteExam(id);
    if (existing) await audit.logAdmin(actor, { category: "exams", action: "exam.delete", summary: `حذف الاختبار «${existing.title}» بكل أسئلته وتسليماته`, target: existing.title });
    return {};
  });

export const adminQuestionsFn = createServerFn({ method: "GET" })
  .validator((examId: string) => examId)
  .handler(async ({ data: examId }) => {
    const actor = await requireActor();
    access.assertCanAnyAt(actor, ["exams.manage.questions"], { exam: examId });
    return exams.adminListQuestions(examId);
  });

export const adminSaveQuestionFn = createServerFn({ method: "POST" })
  .validator((d: Partial<exams.Question>) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    // السؤال الموجود: الاختبار بتاعه بيتحدد من السيرفر مش من اللي المتصفح بعته
    const examIds = data.id ? await exams.examIdsForQuestions([data.id]) : data.exam_id ? [data.exam_id] : [];
    if (examIds.length === 0) throw new Error("الاختبار غير موجود");
    const examId = examIds[0];
    const exam = await exams.adminGetExam(examId);
    if (data.id) {
      assertExams(actor, "exams.manage.questions.edit", examIds);
      const before = (await exams.adminListQuestions(examId)).find((q) => q.id === data.id);
      const saved = await exams.adminSaveQuestion({ ...data, exam_id: examId });
      const groups = before ? changedGroups(QUESTION_FIELDS, before as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>) : [];
      await audit.logAdmin(actor, {
        category: "questions", action: "question.update", summary: `عدّل سؤال في «${exam?.title ?? ""}»`,
        target: short(saved.text), changes: before ? audit.buildChanges(groups, before as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>) : [],
      });
      return saved;
    }
    assertExams(actor, "exams.manage.questions.add", examIds);
    const saved = await exams.adminSaveQuestion(data);
    await audit.logAdmin(actor, { category: "questions", action: "question.create", summary: `أضاف سؤال في «${exam?.title ?? ""}»`, target: short(saved.text) });
    return saved;
  });

export const adminDeleteQuestionsFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    const examIds = await exams.examIdsForQuestions(ids);
    assertExams(actor, "exams.manage.questions.delete", examIds);
    await exams.adminDeleteQuestions(ids);
    await audit.logAdmin(actor, { category: "questions", action: "question.delete", summary: `حذف ${ids.length} سؤال`, note: `من ${examIds.length} اختبار` });
    return {};
  });

export const adminBulkQuestionsFn = createServerFn({ method: "POST" })
  .validator((d: { examId: string; kind: exams.QKind; defaultType: "short" | "long"; text: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    access.assertCan(actor, "exams.manage.questions.add", { exam: data.examId });
    const res = await exams.adminBulkAddQuestions(data.examId, data.kind, data.defaultType, data.text);
    const exam = await exams.adminGetExam(data.examId);
    const n = typeof res === "number" ? res : ((res as { added?: number })?.added ?? 0);
    await audit.logAdmin(actor, {
      category: "questions", action: "question.bulk", summary: `أضاف ${n} سؤال دفعة واحدة في «${exam?.title ?? ""}»`,
      note: data.kind === "core" ? "كأسئلة أساسية" : "كأسئلة اختيارية",
    });
    return res;
  });

export const adminAttemptsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["exams.review", "exams.unblock"]);
  const rows = await exams.adminListAttempts();
  if (actor.owner) return rows;
  return rows.filter(
    (r) => access.can(actor, "exams.review.view", { exam: r.exam_id }) || access.can(actor, "exams.unblock", { exam: r.exam_id }),
  );
});

export const adminAttemptFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.view", await exams.examIdsForAttempts([id]));
    const detail = await exams.adminGetAttempt(id);
    if (detail) {
      const a = detail.attempt as unknown as { identity?: string; exam_id?: string };
      const exam = a.exam_id ? await exams.adminGetExam(a.exam_id) : null;
      await audit.logAdmin(actor, { category: "attempts", action: "attempt.view", summary: `اطّلع على إجابات «${a.identity ?? ""}»`, target: exam?.title ?? null });
    }
    return detail;
  });

export const adminGradeAttemptFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; scores: Record<string, number | string | null>; feedback?: Record<string, string> }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const examIds = await exams.examIdsForAttempts([data.id]);
    assertExams(actor, "exams.review.grade", examIds);
    const res = await exams.adminGradeAttempt(data.id, data.scores ?? {}, data.feedback ?? {}, actor.user.account_name || actor.user.email);
    const note = await describeAttempts([data.id]);
    await audit.logAdmin(actor, { category: "attempts", action: "attempt.grade", summary: `صحّح تسليم (${res.total}/${res.max})`, note });
    return res;
  });

async function describeAttempts(ids: string[]): Promise<string> {
  const set = new Set(ids);
  const rows = (await exams.adminListAttempts()).filter((r) => set.has(r.id));
  return rows.slice(0, 8).map((r) => `${r.identity}${r.block_code ? ` (${r.block_code})` : ""} — ${r.exam_title}`).join("\n") + (rows.length > 8 ? `\n… و${rows.length - 8} كمان` : "");
}

export const adminUnblockFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.unblock", await exams.examIdsForAttempts(ids));
    const note = await describeAttempts(ids);
    const res = await exams.adminUnblock(ids);
    await audit.logAdmin(actor, { category: "attempts", action: "attempt.unblock", summary: `فك الحظر عن ${ids.length} شخص`, note });
    return res;
  });

export const adminRetakeFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.unblock", await exams.examIdsForAttempts(ids));
    const note = await describeAttempts(ids);
    const res = await exams.adminAllowRetake(ids);
    await audit.logAdmin(actor, { category: "attempts", action: "attempt.retake", summary: `سمح بمحاولة جديدة لـ ${ids.length} شخص`, note });
    return res;
  });

export const adminDeleteAttemptsFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.delete", await exams.examIdsForAttempts(ids));
    const note = await describeAttempts(ids);
    await exams.adminDeleteAttempts(ids);
    await audit.logAdmin(actor, { category: "attempts", action: "attempt.delete", summary: `حذف ${ids.length} تسليم`, note });
    return {};
  });
