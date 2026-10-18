// Endpoint للـ sendBeacon: بيتنادى لما الصفحة تتقفل/تتعمل ريفريش (pagehide)،
// لأن server functions مش مناسبة للـ beacon.
import { createFileRoute } from "@tanstack/react-router";
import { reportLeave, type BlockReason } from "@/lib/exams.server";

export const Route = createFileRoute("/api/exam-leave")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = JSON.parse(await request.text()) as {
            attemptId?: string;
            token?: string;
            reason?: BlockReason;
            answers?: Record<string, string>;
          };
          if (!body.attemptId || !body.token) return new Response("bad request", { status: 400 });
          const reason: BlockReason = body.reason === "tab_switch" ? "tab_switch" : "leave";
          await reportLeave(body.attemptId, body.token, reason, body.answers);
          return new Response("ok");
        } catch {
          return new Response("bad request", { status: 400 });
        }
      },
    },
  },
});
