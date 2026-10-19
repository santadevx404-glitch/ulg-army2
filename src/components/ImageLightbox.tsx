// عارض صور كبير (بيتفتح لما تدوس على صورة). Esc أو الضغط بره بيقفله، والأسهم للتنقل.
// - بيتعرض فوق كل حاجة (portal على body) والسايد بار بيدخل جوا البار بتاعه وهو مفتوح ويرجع لما يتقفل.
// - زرار تحميل (مخفي للصور البرايفت).
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, EyeOff, X } from "lucide-react";
import { setLightboxOpen } from "@/lib/lightbox-state";
import { PrivateImage } from "@/components/PrivateImage";

export type LightboxItem = { url: string; private?: boolean };

export function ImageLightbox({
  items, index, onIndex, onClose,
}: { items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    setLightboxOpen(true);
    return () => setLightboxOpen(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index < items.length - 1) onIndex(index + 1);
      if (e.key === "ArrowRight" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndex, onClose]);

  const item = items[index];
  if (!item || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute top-4 left-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="إغلاق"><X className="h-6 w-6" /></button>
        {item.private ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 text-white/80 text-xs px-3 py-2" title="الصورة دي برايفت: التحميل ممنوع"><EyeOff className="h-4 w-4" />صورة برايفت</span>
        ) : (
          <a href={`${item.url}?download=1`} download className="inline-flex items-center gap-1.5 rounded-full bg-black/50 text-white hover:text-[var(--gold)] text-sm px-3 py-2" title="تحميل الصورة"><Download className="h-5 w-5" />تحميل</a>
        )}
      </div>
      {items.length > 1 && index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }} className="absolute right-4 p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="السابقة"><ChevronRight className="h-7 w-7" /></button>
      )}
      {items.length > 1 && index < items.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="التالية"><ChevronLeft className="h-7 w-7" /></button>
      )}
      <div onClick={(e) => e.stopPropagation()}>
        {item.private ? (
          <PrivateImage key={item.url} src={item.url} className="max-h-[88vh] max-w-[92vw] object-contain rounded-lg" />
        ) : (
          <img src={item.url} alt="" draggable={false} className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg shadow-2xl" />
        )}
      </div>
      {items.length > 1 && <div className="absolute bottom-4 text-white text-sm bg-black/50 rounded-full px-3 py-1">{index + 1} / {items.length}</div>}
    </div>,
    document.body,
  );
}
