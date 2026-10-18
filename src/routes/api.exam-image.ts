// رفع/حذف صور إجابات الاختبار. الجسم = بايتات الصورة الخام، والباقي في الـ query.
import { createFileRoute } from "@tanstack/react-router";
import { MAX_IMAGE_BYTES } from "@/lib/exam-images.server";
import { addAttemptImage, removeAttemptImage } from "@/lib/exams.server";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/exam-image")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const q = new URL(request.url).searchParams;
          const attemptId = q.get("attemptId") ?? "";
          const token = q.get("token") ?? "";
          const qid = q.get("qid") ?? "";
          if (!attemptId || !token || !qid) return json({ state: "rejected", error: "طلب غير صالح" }, 400);
          const len = Number(request.headers.get("content-length") ?? 0);
          if (len > MAX_IMAGE_BYTES + 1024) return json({ state: "rejected", error: "الصورة أكبر من 4 ميجا" }, 413);
          const bytes = Buffer.from(await request.arrayBuffer());
          return json(await addAttemptImage(attemptId, token, qid, bytes));
        } catch {
          return json({ state: "rejected", error: "فشل رفع الصورة" }, 400);
        }
      },
      DELETE: async ({ request }: { request: Request }) => {
        try {
          const q = new URL(request.url).searchParams;
          const attemptId = q.get("attemptId") ?? "";
          const token = q.get("token") ?? "";
          const qid = q.get("qid") ?? "";
          const name = q.get("name") ?? "";
          if (!attemptId || !token || !qid || !name) return json({ state: "rejected", error: "طلب غير صالح" }, 400);
          return json(await removeAttemptImage(attemptId, token, qid, name));
        } catch {
          return json({ state: "rejected", error: "فشل حذف الصورة" }, 400);
        }
      },
    },
  },
});
