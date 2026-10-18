// عرض صورة بروفايل — للمسجّلين بس (الدردشات مقفولة على غير الأعضاء).
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import { readAvatar } from "@/lib/avatars.server";

export const Route = createFileRoute("/api/avatar/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { name: string } }) => {
        if (!(await access.actorFromRequest(request))) return new Response("unauthorized", { status: 401 });
        const img = await readAvatar(params.name);
        if (!img) return new Response("not found", { status: 404 });
        return new Response(new Uint8Array(img.data), {
          headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
        });
      },
    },
  },
});
