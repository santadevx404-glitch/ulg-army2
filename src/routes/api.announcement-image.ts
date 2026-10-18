// رفع صورة إعلان (الجسم = بايتات الصورة الخام). لازم صلاحية على الإعلانات.
// الصورة بتتربط بالإعلان لما يتحفظ.
import { createFileRoute } from "@tanstack/react-router";
import * as access from "@/lib/access.server";
import * as ann from "@/lib/announcements.server";
import { detectImageExt } from "@/lib/image-store.server";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/announcement-image")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const actor = await access.actorFromRequest(request);
          if (!actor) return json({ error: "غير مسجل الدخول" }, 401);
          if (!access.canAny(actor, "announcements.create") && !access.canAny(actor, "announcements.edit")) {
            return json({ error: "ليس لديك صلاحية لهذا الإجراء" }, 403);
          }
          const len = Number(request.headers.get("content-length") ?? 0);
          if (len > ann.MAX_ANNOUNCEMENT_IMAGE_BYTES + 1024) return json({ error: "الصورة أكبر من 4 ميجا" }, 413);
          const bytes = Buffer.from(await request.arrayBuffer());
          if (bytes.length > ann.MAX_ANNOUNCEMENT_IMAGE_BYTES) return json({ error: "الصورة أكبر من 4 ميجا" }, 413);
          const ext = detectImageExt(bytes);
          if (!ext) return json({ error: "الملف مش صورة مدعومة (JPG / PNG / WEBP / GIF)" }, 400);
          return json({ name: await ann.announcementImages.save(bytes, ext) });
        } catch {
          return json({ error: "فشل رفع الصورة" }, 400);
        }
      },
    },
  },
});
