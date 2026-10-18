// عرض صورة من دردشة — للمسجّلين اللي يقدروا يفتحوا الدردشة دي بس.
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import * as chat from "@/lib/chat.server";

export const Route = createFileRoute("/api/chat-image/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { name: string } }) => {
        const actor = await access.actorFromRequest(request);
        if (!actor) return new Response("unauthorized", { status: 401 });
        const reg = await chat.getUpload(params.name);
        if (!reg) return new Response("not found", { status: 404 });
        const c = await chat.getChat(reg.chat_id);
        // الصورة اللي لسه متبعتتش الرافع بس هو اللي يشوفها. بعد الإرسال أي حد يقدر يفتح الدردشة يشوفها.
        const allowed = c && (reg.used ? chat.canOpenChat(actor, c) : reg.user_id === actor.user.id);
        if (!allowed) return new Response("forbidden", { status: 403 });
        const img = await chat.chatImages.read(params.name);
        if (!img) return new Response("not found", { status: 404 });
        return new Response(new Uint8Array(img.data), {
          headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
        });
      },
    },
  },
});
