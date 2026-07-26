import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "الرئيسية — موقع حرس الحدود" },
      { name: "description", content: "مرحبًا بك في موقع حرس الحدود الرسمي." },
      { property: "og:title", content: "الرئيسية — موقع حرس الحدود" },
      { property: "og:description", content: "مرحبًا بك في موقع حرس الحدود الرسمي." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div className="text-center max-w-4xl relative z-10">
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
          className="inline-flex mb-8"
        >
          <div className="p-6 rounded-full bg-gradient-to-br from-[var(--gold)] to-[oklch(0.55_0.1_70)] shadow-[var(--shadow-glow)]">
            <Shield className="h-16 w-16 text-[oklch(0.18_0.02_80)]" strokeWidth={2.5} />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.9 }}
          className="text-5xl md:text-7xl font-black leading-tight mb-6"
        >
          <span className="gold-text">مرحبًا بك في</span>
          <br />
          <span className="text-foreground">موقع حرس الحدود</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.9 }}
          className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
        >
          المنصة الرسمية التي تستعرض إنجازات حرس الحدود وأسلحته وآلياته ودوراته وأماكنه المعتمدة.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
          className="mt-14 flex justify-center"
        >
          <div className="h-px w-40 bg-gradient-to-l from-transparent via-[var(--gold)] to-transparent" />
        </motion.div>
      </div>

      {/* Decorative rings */}
      <motion.div
        aria-hidden
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 0.5, duration: 2 }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div className="w-[600px] h-[600px] rounded-full border border-[var(--gold)]/30 animate-pulse" />
        <div className="absolute w-[800px] h-[800px] rounded-full border border-[var(--gold)]/20" />
        <div className="absolute w-[1000px] h-[1000px] rounded-full border border-[var(--gold)]/10" />
      </motion.div>
    </div>
  );
}
