// عارض صور كبير (بيتفتح لما تدوس على صورة). Esc أو الضغط بره بيقفله، والأسهم للتنقل.
import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export function ImageLightbox({
  urls, index, onIndex, onClose,
}: { urls: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index < urls.length - 1) onIndex(index + 1);
      if (e.key === "ArrowRight" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, urls.length, onIndex, onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 left-4 p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="إغلاق"><X className="h-6 w-6" /></button>
      {urls.length > 1 && index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }} className="absolute right-4 p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="السابقة"><ChevronRight className="h-7 w-7" /></button>
      )}
      {urls.length > 1 && index < urls.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }} className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:text-[var(--gold)]" title="التالية"><ChevronLeft className="h-7 w-7" /></button>
      )}
      <img src={urls[index]} alt="" onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg shadow-2xl" />
      {urls.length > 1 && <div className="absolute bottom-4 text-white text-sm bg-black/50 rounded-full px-3 py-1">{index + 1} / {urls.length}</div>}
    </div>
  );
}
