import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { itemByIdQuery } from "@/lib/queries";
import { FormattedText } from "@/lib/formatted-text";
import { MiniPasswordGate } from "@/components/MiniPasswordGate";

export const Route = createFileRoute("/s/$slug/$id")({
  loader: async ({ params, context }) => {
    const item = await context.queryClient.ensureQueryData(itemByIdQuery(params.id));
    if (!item) throw notFound();
    return item;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "تفاصيل"} — حرس الحدود` },
      { name: "description", content: loaderData?.short_description ?? "تفاصيل العنصر" },
      { property: "og:title", content: `${loaderData?.title ?? "تفاصيل"} — حرس الحدود` },
      { property: "og:description", content: loaderData?.short_description ?? "تفاصيل العنصر" },
      ...(loaderData?.cover_image
        ? [
            { property: "og:image", content: loaderData.cover_image },
            { name: "twitter:image", content: loaderData.cover_image },
          ]
        : []),
    ],
  }),
  component: ItemPage,
  errorComponent: ({ error }) => <div className="p-8 text-center">{error.message}</div>,
  notFoundComponent: () => (
    <div className="p-16 text-center">
      <h1 className="text-3xl gold-text font-bold">العنصر غير موجود</h1>
    </div>
  ),
});

function ItemPage() {
  const { slug } = Route.useParams();
  const { id } = Route.useParams();
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [attempted, setAttempted] = useState(false);
  const { data: result, isLoading } = useQuery(itemByIdQuery(id, password));
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  if (isLoading) return <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>;
  if (!result) return <div className="p-16 text-center text-muted-foreground">العنصر غير موجود</div>;

  if (result.locked) {
    return (
      <div className="max-w-sm mx-auto">
        <MiniPasswordGate
          title={result.title}
          wrongPassword={attempted}
          onSubmit={(pw) => { setPassword(pw); setAttempted(true); }}
        />
      </div>
    );
  }

  const item = result;
  const galleryImages = item.gallery;

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10">
      <Link to="/s/$slug" params={{ slug }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-[var(--gold)] mb-6">
        <ArrowRight className="h-4 w-4" />العودة إلى {item.sections?.name}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}
        className="mil-card overflow-hidden"
      >
        {item.cover_image && (
          <div className="aspect-[21/9] overflow-hidden">
            <img src={item.cover_image} alt={item.title} className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-6 md:p-10">
          <h1 className="text-3xl md:text-5xl font-black gold-text mb-4">{item.title}</h1>
          {item.short_description && <p className="text-lg text-muted-foreground mb-6"><FormattedText text={item.short_description} /></p>}
          {item.full_description && (
            <div className="prose prose-invert max-w-none text-foreground/90 leading-loose">
              <FormattedText text={item.full_description} />
            </div>
          )}
        </div>
      </motion.div>

      {galleryImages.length > 0 && (
        <div className="mt-10">
          <h2 className="text-2xl font-bold mb-4 gold-text">معرض الصور</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {galleryImages.map((g, i) => (
              <motion.button
                key={g.url + i}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 8) * 0.05 }}
                onClick={() => setLightbox(g)}
                className="mil-card overflow-hidden ripple text-right"
              >
                <div className="aspect-square overflow-hidden">
                  <img src={g.url} alt={g.caption} className="w-full h-full object-cover" loading="lazy" />
                </div>
                {g.caption && <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{g.caption}</div>}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button className="absolute top-6 right-6 p-2 rounded-full bg-white/10 hover:bg-white/20" onClick={() => setLightbox(null)}>
            <X className="h-6 w-6" />
          </button>
          <motion.img
            initial={{ scale: 0.9 }} animate={{ scale: 1 }}
            src={lightbox.url} alt={lightbox.caption} className="max-w-full max-h-full object-contain rounded-lg"
          />
          {lightbox.caption && (
            <div className="absolute bottom-6 inset-x-6 text-center text-white/90 text-sm bg-black/50 rounded-lg py-2 px-4">
              {lightbox.caption}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
