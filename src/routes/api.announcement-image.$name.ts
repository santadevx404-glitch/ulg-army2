// عرض صورة إعلان — عامة (الإعلانات بتظهر للزوار). الاسم عشوائي طويل.
import { createFileRoute } from "@tanstack/react-router";
import * as ann from "@/lib/announcements.server";

export const Route = createFileRoute("/api/announcement-image/$name")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { name: string } }) => {
        const img = await ann.announcementImages.read(params.name);
        if (!img) return new Response("not found", { status: 404 });
        return new Response(new Uint8Array(img.data), {
          headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
        });
      },
    },
  },
});
