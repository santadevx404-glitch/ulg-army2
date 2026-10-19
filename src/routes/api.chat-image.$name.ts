// عرض / تحميل صورة من دردشة — للمسجّلين اللي يقدروا يفتحوا الدردشة دي بس.
// الصور البرايفت: ممنوع تحميلها، وممنوع تتفتح كصفحة لوحدها (بتتعرض جوه الموقع بس) وبدون كاش.
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import * as chat from "@/lib/chat.server";

export const Route = createFileRoute("/api/chat-image/$name")({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { name: string } }) => {
        const url = new URL(request.url);
        const wantsDownload = url.searchParams.get("download") === "1";
        // بالتوازي: الجلسة + سجل الصورة + ملف الصورة نفسه (أسرع بكتير من ورا بعض)
        const [actor, cachedReg, img] = await Promise.all([
          access.actorFromRequest(request),
          chat.getUpload(params.name),
          chat.chatImages.read(params.name),
        ]);
        if (!actor) return new Response("unauthorized", { status: 401 });
        // لو الكاش القصير قال "مش مسموح" نتأكد بقراءة جديدة (ممكن الصورة لسه اتبعتت من لحظة)
        let reg = cachedReg;
        const check = async (r: NonNullable<typeof reg>) => {
          const c = await chat.getChatFast(r.chat_id);
          return !!c && (r.used ? chat.canOpenChat(actor, c) : r.user_id === actor.user.id);
        };
        if (!reg) reg = await chat.getUpload(params.name, true);
        if (!reg) return new Response("not found", { status: 404 });
        let allowed = await check(reg);
        if (!allowed) {
          reg = (await chat.getUpload(params.name, true)) ?? reg;
          allowed = await check(reg);
        }
        // الصورة اللي لسه متبعتتش الرافع بس هو اللي يشوفها. بعد الإرسال أي حد يقدر يفتح الدردشة يشوفها.
        if (!allowed) return new Response("forbidden", { status: 403 });
        if (!img) return new Response("not found", { status: 404 });

        if (reg.private) {
          if (wantsDownload) return new Response("private image", { status: 403 });
          // فتح الرابط مباشرة في تاب (Sec-Fetch-Dest: document) ممنوع على الصور البرايفت
          const dest = request.headers.get("sec-fetch-dest");
          if (dest === "document" || dest === "iframe" || dest === "embed" || dest === "object") return new Response("private image", { status: 403 });
        }

        const headers: Record<string, string> = {
          "Content-Type": img.type,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": reg.private ? "no-store" : "private, max-age=3600",
        };
        if (wantsDownload) {
          const ext = params.name.split(".").pop() || "jpg";
          headers["Content-Disposition"] = `attachment; filename="image-${params.name.slice(0, 8)}.${ext}"`;
        }
        return new Response(new Uint8Array(img.data), { headers });
      },
    },
  },
});
