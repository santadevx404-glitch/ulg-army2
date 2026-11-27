// فتح الموقع المعطّل لصاحب كود المطوّر (الكوكي بتتحط على متصفحه بس).
import { createFileRoute } from "@tanstack/react-router";
import { checkDevCode, DEV_COOKIE, DEV_COOKIE_MAX_AGE, makeDevToken } from "@/lib/site-lock.server";

export const Route = createFileRoute("/api/site-unlock")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const { code } = (await request.json()) as { code?: string };
          const r = await checkDevCode(String(code ?? ""));
          if (!r.ok) return Response.json({ ok: false, limited: !!r.limited }, { status: r.limited ? 429 : 401 });
          const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "content-type": "application/json",
              "set-cookie": `${DEV_COOKIE}=${encodeURIComponent(await makeDevToken())}; Path=/; Max-Age=${DEV_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
            },
          });
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
      },
    },
  },
});
