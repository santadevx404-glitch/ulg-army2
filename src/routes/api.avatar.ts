// رفع/حذف صورة البروفايل. الجسم = بايتات الصورة الخام، والمستخدم بيتحدد من كوكي الجلسة.
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import * as auth from "@/lib/local-auth.server";
import { MAX_AVATAR_BYTES, deleteAvatar, detectAvatarExt, saveAvatar } from "@/lib/avatars.server";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/avatar")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const actor = await access.actorFromRequest(request);
          if (!actor) return json({ error: "غير مسجل الدخول" }, 401);
          const len = Number(request.headers.get("content-length") ?? 0);
          if (len > MAX_AVATAR_BYTES + 1024) return json({ error: "الصورة أكبر من 2 ميجا" }, 413);
          const bytes = Buffer.from(await request.arrayBuffer());
          if (bytes.length > MAX_AVATAR_BYTES) return json({ error: "الصورة أكبر من 2 ميجا" }, 413);
          const ext = detectAvatarExt(bytes);
          if (!ext) return json({ error: "الملف مش صورة مدعومة (JPG / PNG / WEBP / GIF)" }, 400);
          const name = await saveAvatar(bytes, ext);
          const old = await auth.setUserAvatar(actor.user.id, name);
          await deleteAvatar(old);
          return json({ avatar: name });
        } catch {
          return json({ error: "فشل رفع الصورة" }, 400);
        }
      },
      DELETE: async ({ request }: { request: Request }) => {
        try {
          const actor = await access.actorFromRequest(request);
          if (!actor) return json({ error: "غير مسجل الدخول" }, 401);
          const old = await auth.setUserAvatar(actor.user.id, null);
          await deleteAvatar(old);
          return json({ avatar: null });
        } catch {
          return json({ error: "فشل حذف الصورة" }, 400);
        }
      },
    },
  },
});
