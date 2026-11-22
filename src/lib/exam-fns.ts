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
    open: access.can(actor, "exams.open", scope),
    close: access.can(actor, "exams.close", scope),
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
  .validator((d: { attemptId: string; token: string; answers: Record<string, string>; final?: boolean; left?: string; cur?: string; seen?: number }) => d)
  .handler(async ({ data }) => exams.saveAnswers(data.attemptId, data.token, data.answers, !!data.final, data.left ? String(data.left) : "", data.cur, data.seen ?? 0));

export const reportLeaveFn = createServerFn({ method: "POST" })
  .validator((d: { attemptId: string; token: string; reason: exams.BlockReason; answers?: Record<string, string>; vid?: string; cur?: string }) => d)
  .handler(async ({ data }) => exams.reportLeave(data.attemptId, data.token, data.reason, data.answers, data.vid, data.cur));

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
  { id: "correct_answer", label: "الإجابة الصح (للتصحيح التلقائي)", fields: ["correct_answer", "wrong_part"] },
];

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n)}…` : t);

export const adminExamsFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  const list = await exams.adminListExams();
  return list
    .filter((e) => actor.full || access.canAnyAt(actor, "exams", { exam: e.id }))
    .map((e) => {
      const can = examCan(actor, e.id);
      // كلمة سر الاختبار مبتظهرش غير لمن يقدر يعدّل نوع الاختبار
      // ولو الاختبار مفتوح بالزرار فكلمته العشوائية بتظهر لمن يقدر يفتحه
      return { ...e, password: can.settings.access || (can.open && e.open_until) ? e.password : e.password ? MASK : null, open_prev: null, can };
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
    if (!actor.full) await auth.addGrants(actor.user.id, [wildcardKey("exam", created.id)]); // اللي عمل الاختبار يديره
    await audit.logAdmin(actor, { category: "exams", action: "exam.create", summary: `أنشأ اختبار «${created.title}»`, target: created.title });
    return created;
  });

export const adminOpenExamFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    access.assertCan(actor, "exams.open", { exam: id });
    const existing = await exams.adminGetExam(id);
    if (!existing) throw new Error("الاختبار غير موجود");
    const res = await exams.adminOpenExam(id, actor.user.account_name || actor.user.email);
    await audit.logAdmin(actor, { category: "exams", action: "exam.open", summary: `فتح الاختبار «${existing.title}» لمدة ${exams.OPEN_HOURS} ساعة`, target: existing.title });
    return res;
  });

export const adminCloseExamFn = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    access.assertCan(actor, "exams.close", { exam: id });
    const existing = await exams.adminGetExam(id);
    if (!existing) throw new Error("الاختبار غير موجود");
    await exams.adminCloseExam(id);
    await audit.logAdmin(actor, { category: "exams", action: "exam.close", summary: `أغلق الاختبار «${existing.title}»`, target: existing.title });
    return {};
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
  if (actor.full) return rows;
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

// ==================== الأرشيف والتظلمات ====================

export const adminArchiveFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.archive", await exams.examIdsForAttempts(ids));
    const note = await describeAttempts(ids);
    const res = await exams.adminArchiveAttempts(ids);
    await audit.logAdmin(actor, { category: "attempts", action: "attempt.archive", summary: `أرشف ${res.count} تسليم`, note });
    return res;
  });

export const adminArchiveListFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["exams.review.archive"]);
  const rows = await exams.adminListArchive();
  return actor.full ? rows : rows.filter((r) => access.can(actor, "exams.review.archive", { exam: r.exam_id }));
});

export const adminArchiveItemFn = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.archive", await exams.archiveExamIds([id]));
    return exams.adminGetArchive(id);
  });

export const adminGradeArchiveFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; scores: Record<string, number | string | null>; feedback?: Record<string, string> }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    const examIds = await exams.archiveExamIds([data.id]);
    assertExams(actor, "exams.review.archive", examIds);
    assertExams(actor, "exams.review.grade", examIds);
    const res = await exams.adminGradeArchive(data.id, data.scores ?? {}, data.feedback ?? {}, actor.user.account_name || actor.user.email);
    await audit.logAdmin(actor, { category: "attempts", action: "archive.grade", summary: `عدّل تصحيح نسخة أرشيف (${res.total}/${res.max})` });
    return res;
  });

export const adminRestoreArchiveFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; regrade: boolean }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.archive", await exams.archiveExamIds([data.id]));
    const res = await exams.adminRestoreArchive(data.id, !!data.regrade);
    await audit.logAdmin(actor, { category: "attempts", action: "archive.restore", summary: data.regrade ? "استرجع تسليم من الأرشيف لإعادة التصحيح" : "استرجع تسليم من الأرشيف" });
    return res;
  });

/** مسح نهائي من الأرشيف — صاحب الموقع بس. */
export const ownerDeleteArchiveFn = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .handler(async ({ data: ids }) => {
    const actor = await requireActor();
    if (!actor.owner) throw new Error("مسح الأرشيف نهائيًا لصاحب الموقع بس");
    const res = await exams.ownerDeleteArchive(ids);
    await audit.logAdmin(actor, { category: "attempts", action: "archive.delete", summary: `مسح ${res.count} نسخة من الأرشيف نهائيًا` });
    return res;
  });

export const createGrievanceFn = createServerFn({ method: "POST" })
  .validator((d: { attempt_id: string; qid: string | null; message: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    return exams.createGrievance(actor.user.id, data.attempt_id, data.qid, data.message);
  });

export const adminGrievancesFn = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireActor();
  access.assertCanAny(actor, ["exams.review.grievances"]);
  const rows = await exams.adminListGrievances();
  return actor.full ? rows : rows.filter((g) => access.can(actor, "exams.review.grievances", { exam: g.exam_id }));
});

export const adminResolveGrievanceFn = createServerFn({ method: "POST" })
  .validator((d: { id: string; status: "open" | "accepted" | "rejected"; response: string }) => d)
  .handler(async ({ data }) => {
    const actor = await requireActor();
    assertExams(actor, "exams.review.grievances", await exams.grievanceExamIds([data.id]));
    const g = await exams.adminResolveGrievance(data.id, data.status, data.response, actor.user.account_name || actor.user.email);
    await audit.logAdmin(actor, { category: "attempts", action: "grievance.resolve", summary: `رد على تظلم (${data.status === "accepted" ? "مقبول" : data.status === "rejected" ? "مرفوض" : "أُعيد فتحه"})`, target: g.identity, note: g.response || null });
    return g;
  });
