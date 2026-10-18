// رفع صورة لرسالة دردشة (الجسم = بايتات الصورة الخام). الصورة بتتسجّل باسم الرافع والدردشة،
// وبعدين sendMessageFn بيستهلكها. DELETE بيلغي صورة اترفعت ولسه متبعتتش.
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import * as chat from "@/lib/chat.server";
import { detectImageExt } from "@/lib/image-store.server";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// 30 رفعة في الدقيقة لكل شخص
const uploads = new Map<string, number[]>();
function tooMany(userId: string): boolean {
  const now = Date.now();
  const fresh = (uploads.get(userId) ?? []).filter((t) => now - t < 60_000);
  uploads.set(userId, fresh);
  if (fresh.length >= 30) return true;
  fresh.push(now);
  return false;
}

export const Route = createFileRoute("/api/chat-image")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const actor = await access.actorFromRequest(request);
          if (!actor) return json({ error: "غير مسجل الدخول" }, 401);
          const chatId = new URL(request.url).searchParams.get("chatId") ?? "";
          const c = await chat.getChat(chatId);
          if (!c || !chat.canOpenChat(actor, c)) return json({ error: "الدردشة مقفولة" }, 403);
          if (!c.allow_images) return json({ error: "إرسال الصور موقوف في الدردشة دي" }, 403);
          if (tooMany(actor.user.id)) return json({ error: "صور كتير في وقت قصير، استنى شوية" }, 429);
          const len = Number(request.headers.get("content-length") ?? 0);
          if (len > chat.MAX_CHAT_IMAGE_BYTES + 1024) return json({ error: "الصورة أكبر من 4 ميجا" }, 413);
          const bytes = Buffer.from(await request.arrayBuffer());
          if (bytes.length > chat.MAX_CHAT_IMAGE_BYTES) return json({ error: "الصورة أكبر من 4 ميجا" }, 413);
          const ext = detectImageExt(bytes);
          if (!ext) return json({ error: "الملف مش صورة مدعومة (JPG / PNG / WEBP / GIF)" }, 400);
          const name = await chat.chatImages.save(bytes, ext);
          await chat.registerUpload(name, actor.user.id, c.id);
          return json({ name });
        } catch {
          return json({ error: "فشل رفع الصورة" }, 400);
        }
      },
      DELETE: async ({ request }: { request: Request }) => {
        try {
          const actor = await access.actorFromRequest(request);
          if (!actor) return json({ error: "غير مسجل الدخول" }, 401);
          const name = new URL(request.url).searchParams.get("name") ?? "";
          const removed = await chat.removeOwnUnusedUpload(name, actor.user.id);
          return json({ removed });
        } catch {
          return json({ error: "فشل" }, 400);
        }
      },
    },
  },
});
