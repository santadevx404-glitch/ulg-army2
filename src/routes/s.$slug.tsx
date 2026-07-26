import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { ArrowLeft, Lock, Loader2 } from "lucide-react";
import { sectionBySlugQuery } from "@/lib/queries";
import { unlockSectionFn } from "@/lib/server-fns";
import { ItemModal } from "@/components/ItemModal";
import { CourseTopicsModal } from "@/components/CourseTopicsModal";
import { FormattedText } from "@/lib/formatted-text";

export const Route = createFileRoute("/s/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(sectionBySlugQuery(params.slug));
    if (!data.section) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.section?.name ?? "قسم";
    return {
      meta: [
        { title: `${name} — حرس الحدود` },
        { name: "description", content: `تصفح ${name} على موقع حرس الحدود.` },
        { property: "og:title", content: `${name} — حرس الحدود` },
        { property: "og:description", content: `تصفح ${name} على موقع حرس الحدود.` },
      ],
    };
  },
  component: SectionPage,
  errorComponent: ({ error }) => <div className="p-8 text-center">{error.message}</div>,
  notFoundComponent: () => (
    <div className="p-16 text-center">
      <h1 className="text-3xl gold-text font-bold">القسم غير موجود</h1>
      <Link to="/" className="btn-gold inline-block mt-6 ripple">الرئيسية</Link>
    </div>
  ),
});

function SectionPage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(sectionBySlugQuery(slug));
  const { section, items: fetchedItems } = data;
  const [openId, setOpenId] = useState<string | null>(null);
  // ملحوظة: unlockedItems حالة محلية بس (React state) — بترجع فاضية تلقائي
  // مع أي ريفريش للصفحة، فبيتطلب كلمة السر تاني زي ما هو مطلوب.
  const [unlockedItems, setUnlockedItems] = useState<typeof fetchedItems | null>(null);

  const isLocked = !!section?.locked && !unlockedItems;
  const items = unlockedItems ?? fetchedItems;
  const openItem = items.find((i) => i.id === openId);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <div className="mb-10 pb-6 border-b border-border">
          <div className="text-sm text-muted-foreground mb-2">حرس الحدود</div>
          <h1 className="text-4xl md:text-5xl font-black gold-text">{section!.name}</h1>
        </div>
      </motion.div>

      {isLocked ? (
        <PasswordGate slug={slug} onUnlock={setUnlockedItems} />
      ) : items.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p>لا توجد عناصر منشورة في هذا القسم بعد.</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <motion.div
              key={it.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, delay: (i % 6) * 0.08 }}
            >
              <button
                type="button"
                onClick={() => setOpenId(it.id)}
                className="mil-card block group h-full w-full text-right"
              >
                {it.cover_image && (
                  <div className="aspect-[16/10] overflow-hidden bg-muted">
                    <img src={it.cover_image} alt={it.title} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                )}
                <div className="p-5 space-y-3">
                  <h3 className="text-xl font-bold group-hover:text-[var(--gold)] transition-colors flex items-center gap-2">
                    {it.title}
                    {it.locked && <Lock className="h-4 w-4 text-muted-foreground shrink-0" />}
                  </h3>
                  {it.short_description && (
                    <p className="text-sm text-muted-foreground line-clamp-3"><FormattedText text={it.short_description} /></p>
                  )}
                  <div className="pt-2 flex items-center gap-2 text-sm font-semibold text-[var(--gold)] group-hover:gap-3 transition-all">
                    <span>{it.use_topics ? "عرض المواضيع" : "قراءة المزيد"}</span>
                    <ArrowLeft className="h-4 w-4" />
                  </div>
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {openId && (openItem?.use_topics
          ? <CourseTopicsModal id={openId} onClose={() => setOpenId(null)} />
          : <ItemModal id={openId} onClose={() => setOpenId(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function PasswordGate({ slug, onUnlock }: { slug: string; onUnlock: (items: any[]) => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await unlockSectionFn({ data: { slug, password } });
      if ("error" in res && res.error) { setError(res.error); return; }
      onUnlock(res.items ?? []);
    } catch {
      setError("حصل خطأ، حاول تاني");
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-sm mx-auto py-16 text-center">
      <div className="mil-card p-8">
        <Lock className="h-10 w-10 mx-auto text-[var(--gold)] mb-4" />
        <h2 className="text-xl font-bold mb-2">هذا القسم محمي بكلمة سر</h2>
        <p className="text-sm text-muted-foreground mb-6">أدخل كلمة السر عشان تقدر تشوف المحتوى.</p>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input text-center"
            placeholder="كلمة السر"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={loading} className="btn-gold ripple w-full inline-flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
