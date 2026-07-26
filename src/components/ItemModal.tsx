import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { itemByIdQuery } from "@/lib/queries";
import { FormattedText } from "@/lib/formatted-text";
import { MiniPasswordGate } from "@/components/MiniPasswordGate";

export function ItemModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [attempted, setAttempted] = useState(false);
  const { data: result, isLoading } = useQuery(itemByIdQuery(id, password));
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  const item = result && !result.locked ? result : null;
  const galleryImages = item ? item.gallery : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="mil-card w-full max-w-2xl my-8 relative"
      >
        <button
          onClick={onClose}
          className="absolute top-4 left-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white"
          aria-label="إغلاق"
        >
          <X className="h-5 w-5" />
        </button>

        {isLoading && (
          <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>
        )}

        {!isLoading && !result && (
          <div className="p-16 text-center text-muted-foreground">تعذر العثور على هذا العنصر.</div>
        )}

        {!isLoading && result?.locked && (
          <MiniPasswordGate
            title={result.title}
            wrongPassword={attempted}
            onSubmit={(pw) => { setPassword(pw); setAttempted(true); }}
          />
        )}

        {item && (
          <>
            {item.cover_image && (
              <div className="aspect-[21/9] overflow-hidden rounded-t-[inherit]">
                <img src={item.cover_image} alt={item.title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="p-6 md:p-10">
              <h1 className="text-2xl md:text-4xl font-black gold-text mb-4">{item.title}</h1>
              {item.short_description && (
                <p className="text-base md:text-lg text-muted-foreground mb-6">
                  <FormattedText text={item.short_description} />
                </p>
              )}
              {item.full_description && (
                <div className="prose prose-invert max-w-none text-foreground/90 leading-loose">
                  <FormattedText text={item.full_description} />
                </div>
              )}
            </div>

            {galleryImages.length > 0 && (
              <div className="px-6 md:px-10 pb-8">
                <h2 className="text-xl font-bold mb-4 gold-text">معرض الصور</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {galleryImages.map((g, i) => (
                    <button
                      key={g.url + i}
                      onClick={() => setLightbox(g)}
                      className="mil-card overflow-hidden ripple text-right"
                    >
                      <div className="aspect-square overflow-hidden">
                        <img src={g.url} alt={g.caption} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      {g.caption && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{g.caption}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>
      </div>

      <AnimatePresence>
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
          >
            <button
              className="absolute top-6 left-6 p-2 rounded-full bg-white/10 hover:bg-white/20"
              onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            >
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
      </AnimatePresence>
    </div>
  );
}
