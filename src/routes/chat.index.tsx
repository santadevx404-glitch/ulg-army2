import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Lock, MessageSquare } from "lucide-react";
import { chatsListFn } from "@/lib/chat-fns";
import { useMe } from "@/lib/use-me";

export const Route = createFileRoute("/chat/")({
  head: () => ({ meta: [{ title: "الدردشات — حرس الحدود" }, { name: "robots", content: "noindex" }] }),
  component: ChatIndex,
});

function ChatIndex() {
  const navigate = useNavigate();
  const { me, loading } = useMe();

  useEffect(() => {
    if (!loading && !me) navigate({ to: "/auth" });
  }, [loading, me, navigate]);

  const { data: chats = [], isLoading } = useQuery({ queryKey: ["chats-list"], queryFn: () => chatsListFn(), enabled: !!me });

  if (loading || !me) return <div className="p-16 text-center text-muted-foreground">جارٍ التحميل...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-10">
      <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-black gold-text mb-2">الدردشات</motion.h1>
      <p className="text-sm text-muted-foreground mb-8">كل دردشة بتتفتح لأصحاب رتبتها بس.</p>

      {isLoading && <div className="text-center text-muted-foreground py-12">جارٍ التحميل...</div>}
      <div className="grid gap-3">
        {chats.map((c) => {
          const body = (
            <div className={`mil-card p-5 flex items-center gap-4 ${c.open ? "hover:border-[var(--gold)] transition" : "opacity-60"}`}>
              {c.open ? <MessageSquare className="h-6 w-6 text-[var(--gold)] shrink-0" /> : <Lock className="h-6 w-6 text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-lg">{c.name}</div>
                {c.description && <div className="text-sm text-muted-foreground mt-0.5">{c.description}</div>}
                <div className="text-xs text-muted-foreground mt-1">
                  {c.open
                    ? c.rank_names.length ? `للرتب: ${c.rank_names.join("، ")}` : ""
                    : !c.enabled ? "الدردشة موقوفة حاليًا" : c.rank_names.length ? `مقفولة — محتاج رتبة: ${c.rank_names.join("، ")}` : "مقفولة"}
                </div>
              </div>
            </div>
          );
          return c.open ? <Link key={c.id} to="/chat/$id" params={{ id: c.id }}>{body}</Link> : <div key={c.id} title="مش معاك رتبة الدردشة دي">{body}</div>;
        })}
        {!isLoading && chats.length === 0 && <div className="text-center text-muted-foreground py-12">مفيش دردشات لسه.</div>}
      </div>
    </div>
  );
}
