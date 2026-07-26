import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown } from "lucide-react";
import { itemByIdQuery, topicsByItemQuery } from "@/lib/queries";
import { FormattedText } from "@/lib/formatted-text";
import { MiniPasswordGate } from "@/components/MiniPasswordGate";

export function CourseTopicsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [attempted, setAttempted] = useState(false);
  const { data: result, isLoading: loadingItem } = useQuery(itemByIdQuery(id, password));
  const item = result && !result.locked ? result : null;
  const { data: topics = [], isLoading: loadingTopics } = useQuery(topicsByItemQuery(id, password));
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

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

        <div className="p-6 md:p-10">
          {loadingItem ? (
            <div className="text-center text-muted-foreground py-8">جارٍ التحميل...</div>
          ) : result?.locked ? (
            <MiniPasswordGate
              title={result.title}
              wrongPassword={attempted}
              onSubmit={(pw) => { setPassword(pw); setAttempted(true); }}
            />
          ) : item ? (
            <>
              {item.cover_image && (
                <div className="w-full aspect-[16/9] overflow-hidden rounded-xl mb-5">
                  <img src={item.cover_image} alt={item.title} className="w-full h-full object-cover" />
                </div>
              )}
              <h1 className="text-2xl md:text-3xl font-black gold-text mb-2 pl-10">{item.title}</h1>
              {item.short_description && (
                <p className="text-muted-foreground mb-6"><FormattedText text={item.short_description} /></p>
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground py-8">تعذر العثور على هذا العنصر.</div>
          )}

          {item && (loadingTopics ? (
            <div className="text-center text-muted-foreground py-6">جارٍ تحميل المواضيع...</div>
          ) : topics.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">لا توجد مواضيع مضافة بعد.</div>
          ) : (
            <div className="space-y-2">
              {topics.map((t) => {
                const isOpen = openTopicId === t.id;
                return (
                  <div key={t.id} className="mil-card overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenTopicId(isOpen ? null : t.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-right hover:text-[var(--gold)] transition-colors"
                    >
                      <span className="font-bold">{t.title}</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 text-sm text-foreground/90 leading-loose border-t border-border pt-3">
                            {t.images && t.images.length > 0 && (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                                {t.images.map((img, i) => (
                                  <button
                                    key={img.url + i}
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setLightbox(img); }}
                                    className="rounded-lg overflow-hidden text-right"
                                  >
                                    <div className="aspect-square overflow-hidden">
                                      <img src={img.url} alt={img.caption} className="w-full h-full object-cover" loading="lazy" />
                                    </div>
                                    {img.caption && (
                                      <div className="text-xs text-muted-foreground mt-1 truncate">{img.caption}</div>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                            <FormattedText text={t.content} />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
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
