// عرض صورة إجابة (للشخص نفسه في الاختبار، وللأدمن في مراجعة التسليمات).
// الاسم عشوائي طويل (32 حرف hex) ومفيش طريقة لتخمينه.
import { createFileRoute } from "@tanstack/react-router";
import { readExamImage } from "@/lib/exam-images.server";

export const Route = createFileRoute("/api/exam-image/$name")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { name: string } }) => {
        const img = await readExamImage(params.name);
        if (!img) return new Response("not found", { status: 404 });
        return new Response(new Uint8Array(img.data), {
          headers: {
            "Content-Type": img.type,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
