// عناصر واجهة مشتركة للوحة التحكم (Modal / Field)
import { motion } from "framer-motion";
import { X } from "lucide-react";

export function Field({ label, children, hint, locked }: { label: string; children: React.ReactNode; hint?: string; locked?: boolean }) {
  return (
    <div className="mb-4">
      <label className="text-sm mb-1 block text-muted-foreground">
        {label}
        {locked && <span className="mr-2 text-xs text-[var(--gold)]">🔒 مفيش صلاحية تعديل</span>}
      </label>
      {locked ? <fieldset disabled className="opacity-50 pointer-events-none">{children}</fieldset> : children}
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

export function Modal({
  children, onClose, title, wide,
}: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className={`mil-card p-6 w-full ${wide ? "max-w-3xl" : "max-w-lg"} my-8`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold gold-text">{title}</h2>
          <button onClick={onClose} className="p-1 hover:text-destructive"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
