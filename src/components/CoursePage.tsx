// عرض الدورة بالنظام الجديد: صفحة كاملة، قايمة مواضيع جانبية مرقّمة ومقسّمة لوحدات،
// السابق/التالي، "كمل من حيث وقفت"، ووضع قراءة.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Home, List, Minus, Play, Plus, X } from "lucide-react";
import { topicsByItemQuery } from "@/lib/queries";
import { FormattedText } from "@/lib/formatted-text";
import type { Topic } from "@/lib/local-store.server";

type CourseItem = {
  id: string;
  title: string;
  short_description: string | null;
  full_description: string | null;
  cover_image: string | null;
  sections?: { name: string; slug: string };
};

const FONT_SIZES = ["text-sm", "text-base", "text-lg", "text-xl"] as const;

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

export function CoursePage({ item, slug, password }: { item: CourseItem; slug: string; password?: string }) {
  const { data: topics = [], isLoading } = useQuery(topicsByItemQuery(item.id, password));
  const [activeId, setActiveId] = useState<string | null>(null); // null = نظرة عامة
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [focus, setFocus] = useState(false); // وضع القراءة
  const [fontIdx, setFontIdx] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false); // قايمة المواضيع على الموبايل
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null);

  const lastKey = `course-last-${item.id}`;
  useEffect(() => {
    setResumeId(lsGet(lastKey));
    const f = Number(lsGet("course-font"));
    if (f >= 0 && f < FONT_SIZES.length && lsGet("course-font") !== null) setFontIdx(f);
    setFocus(lsGet("course-focus") === "1");
  }, [lastKey]);

  const index = useMemo(() => topics.findIndex((t) => t.id === activeId), [topics, activeId]);
  const active: Topic | null = index >= 0 ? topics[index] : null;
  const resumeIdx = useMemo(() => topics.findIndex((t) => t.id === resumeId), [topics, resumeId]);

  // وحدات: المواضيع المتتالية بنفس اسم الوحدة بتتجمّع تحت عنوانها
  const groups = useMemo(() => {
    const out: { unit: string | null; items: { t: Topic; n: number }[] }[] = [];
    topics.forEach((t, i) => {
      const unit = t.unit ?? null;
      const last = out[out.length - 1];
      if (last && last.unit === unit) last.items.push({ t, n: i + 1 });
      else out.push({ unit, items: [{ t, n: i + 1 }] });
    });
    return out;
  }, [topics]);

  const open = useCallback((id: string | null) => {
    setActiveId(id);
    setMenuOpen(false);
    if (id) { lsSet(lastKey, id); setResumeId(id); }
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [lastKey]);

  const go = useCallback((delta: number) => {
    const next = topics[index + delta];
    if (next) open(next.id);
  }, [topics, index, open]);

  // أسهم الكيبورد (RTL: السهم الشمال = التالي)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft") go(1);
      else if (e.key === "ArrowRight") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const changeFont = (d: number) => {
    const n = Math.min(FONT_SIZES.length - 1, Math.max(0, fontIdx + d));
    setFontIdx(n);
    lsSet("course-font", String(n));
  };
  const toggleFocus = () => { setFocus((v) => { lsSet("course-focus", v ? "0" : "1"); return !v; }); };

  const TopicList = (
    <nav className="space-y-4">
      <button
        type="button" onClick={() => open(null)}
        className={`w-full text-right flex items-center gap-2 px-3 py-2 rounded-lg transition ${active === null ? "bg-[var(--gold)]/15 text-[var(--gold)]" : "hover:bg-white/5"}`}
      >
        <Home className="h-4 w-4 shrink-0" /><span className="font-semibold">نظرة عامة</span>
      </button>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.unit && <div className="px-3 mb-1.5 text-xs font-bold text-[var(--gold)] tracking-wide">{g.unit}</div>}
          <div className="space-y-1">
            {g.items.map(({ t, n }) => {
              const on = t.id === activeId;
              return (
                <button
                  key={t.id} type="button" onClick={() => open(t.id)}
                  className={`w-full text-right flex items-start gap-3 px-3 py-2.5 rounded-lg transition ${on ? "bg-[var(--gold)]/15 text-[var(--gold)]" : "hover:bg-white/5"}`}
                >
                  <span className={`shrink-0 h-6 w-6 rounded-full text-xs font-bold flex items-center justify-center border ${on ? "border-[var(--gold)] bg-[var(--gold)] text-black" : "border-border text-muted-foreground"}`}>{n}</span>
                  <span className="text-sm leading-6">{t.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`mx-auto p-4 md:p-8 ${focus ? "max-w-3xl" : "max-w-6xl"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <Link to="/s/$slug" params={{ slug }} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-[var(--gold)]">
          <ArrowRight className="h-4 w-4" />العودة إلى {item.sections?.name}
        </Link>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-border overflow-hidden" title="حجم الخط">
            <button type="button" onClick={() => changeFont(-1)} disabled={fontIdx === 0} className="px-2.5 py-1.5 hover:bg-white/5 disabled:opacity-40" aria-label="تصغير الخط"><Minus className="h-4 w-4" /></button>
            <span className="px-1 text-xs text-muted-foreground">خط</span>
            <button type="button" onClick={() => changeFont(1)} disabled={fontIdx === FONT_SIZES.length - 1} className="px-2.5 py-1.5 hover:bg-white/5 disabled:opacity-40" aria-label="تكبير الخط"><Plus className="h-4 w-4" /></button>
          </div>
          <button
            type="button" onClick={toggleFocus}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition ${focus ? "border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10" : "border-border hover:border-[var(--gold)]"}`}
          >
            <BookOpen className="h-4 w-4" />وضع القراءة
          </button>
          {true ? (
            <button type="button" onClick={() => setMenuOpen(true)} className="lg:hidden inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-sm hover:border-[var(--gold)]">
              <List className="h-4 w-4" />المواضيع
            </button>
          ) : null}
        </div>
      </div>

      <div className={focus ? "" : "lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8 lg:items-start"}>
        {/* القايمة الجانبية (كمبيوتر) */}
        {!focus && (
          <aside className="hidden lg:block mil-card p-3 sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
            {isLoading ? <div className="p-4 text-sm text-muted-foreground">جارٍ التحميل...</div> : TopicList}
          </aside>
        )}

        <main className="min-w-0">
          {active === null ? (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mil-card overflow-hidden">
              {item.cover_image && (
                <div className="aspect-[21/9] overflow-hidden"><img src={item.cover_image} alt={item.title} className="w-full h-full object-cover" /></div>
              )}
              <div className="p-6 md:p-8">
                <h1 className="text-3xl md:text-4xl font-black gold-text mb-3">{item.title}</h1>
                {item.short_description && <p className="text-muted-foreground mb-4 leading-loose"><FormattedText text={item.short_description} /></p>}
                {item.full_description && <div className={`${FONT_SIZES[fontIdx]} leading-loose text-foreground/90 mb-4`}><FormattedText text={item.full_description} /></div>}
                {isLoading ? (
                  <div className="text-muted-foreground py-4">جارٍ تحميل المواضيع...</div>
                ) : topics.length === 0 ? (
                  <div className="text-muted-foreground py-4">لا توجد مواضيع مضافة بعد.</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 mt-6">
                    {resumeIdx >= 0 && (
                      <button type="button" onClick={() => open(topics[resumeIdx].id)} className="btn-gold ripple inline-flex items-center gap-2">
                        <Play className="h-4 w-4" />كمّل من حيث وقفت — الموضوع {resumeIdx + 1}: {topics[resumeIdx].title}
                      </button>
                    )}
                    <button
                      type="button" onClick={() => open(topics[0].id)}
                      className={resumeIdx >= 0 ? "px-4 py-2 rounded-lg border border-border hover:border-[var(--gold)]" : "btn-gold ripple inline-flex items-center gap-2"}
                    >
                      {resumeIdx >= 0 ? "ابدأ من الأول" : "ابدأ الدورة"}
                    </button>
                    <span className="text-sm text-muted-foreground">{topics.length} موضوع{groups.some((g) => g.unit) ? ` في ${groups.filter((g) => g.unit).length} وحدة` : ""}</span>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.article
                key={active.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mil-card p-6 md:p-8"
              >
                <div className="text-xs text-muted-foreground mb-2">
                  {active.unit ? `${active.unit} • ` : ""}الموضوع {index + 1} من {topics.length}
                </div>
                <h1 className="text-2xl md:text-3xl font-black gold-text mb-6">{index + 1}. {active.title}</h1>
                {active.images && active.images.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {active.images.map((img, i) => (
                      <button key={img.url + i} type="button" onClick={() => setLightbox(img)} className="rounded-lg overflow-hidden text-right">
                        <div className="aspect-square overflow-hidden"><img src={img.url} alt={img.caption} className="w-full h-full object-cover" loading="lazy" /></div>
                        {img.caption && <div className="text-xs text-muted-foreground mt-1 truncate">{img.caption}</div>}
                      </button>
                    ))}
                  </div>
                )}
                <div className={`${FONT_SIZES[fontIdx]} ${focus ? "leading-[2.2]" : "leading-loose"} text-foreground/90`}>
                  <FormattedText text={active.content} />
                </div>

                <div className="mt-10 pt-6 border-t border-border grid grid-cols-2 gap-3">
                  {index > 0 ? (
                    <button type="button" onClick={() => go(-1)} className="text-right rounded-lg border border-border hover:border-[var(--gold)] px-4 py-3 transition">
                      <div className="text-xs text-muted-foreground flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5" />السابق</div>
                      <div className="font-semibold truncate">{topics[index - 1].title}</div>
                    </button>
                  ) : <div />}
                  {index < topics.length - 1 ? (
                    <button type="button" onClick={() => go(1)} className="text-left rounded-lg border border-[var(--gold)]/50 bg-[var(--gold)]/10 hover:bg-[var(--gold)]/20 px-4 py-3 transition col-start-2">
                      <div className="text-xs text-[var(--gold)] flex items-center gap-1 justify-end"><span>التالي</span><ChevronLeft className="h-3.5 w-3.5" /></div>
                      <div className="font-semibold truncate">{topics[index + 1].title}</div>
                    </button>
                  ) : (
                    <button type="button" onClick={() => open(null)} className="text-left rounded-lg border border-border hover:border-[var(--gold)] px-4 py-3 transition col-start-2">
                      <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end"><span>خلصت الدورة</span><ArrowLeft className="h-3.5 w-3.5" /></div>
                      <div className="font-semibold">الرجوع للنظرة العامة</div>
                    </button>
                  )}
                </div>
              </motion.article>
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* قايمة المواضيع: موبايل + وضع القراءة */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={() => setMenuOpen(false)}>
            <motion.div
              initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-80 max-w-[88%] bg-background border-l border-border p-3 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-3 px-2">
                <span className="font-bold gold-text">مواضيع الدورة</span>
                <button type="button" onClick={() => setMenuOpen(false)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="إغلاق"><X className="h-5 w-5" /></button>
              </div>
              {TopicList}
            </motion.div>
          </motion.div>
        )}
        {lightbox && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setLightbox(null)}
          >
            <button className="absolute top-6 left-6 p-2 rounded-full bg-white/10 hover:bg-white/20" onClick={() => setLightbox(null)}><X className="h-6 w-6" /></button>
            <img src={lightbox.url} alt={lightbox.caption} className="max-w-full max-h-full object-contain rounded-lg" />
            {lightbox.caption && <div className="absolute bottom-6 inset-x-6 text-center text-white/90 text-sm bg-black/50 rounded-lg py-2 px-4">{lightbox.caption}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
