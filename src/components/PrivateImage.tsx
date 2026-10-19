// صورة برايفت: بتتعرض على canvas (مش <img>) فمفيش "حفظ الصورة باسم" ولا سحب ولا رابط مباشر،
// ولما الحماية تشتغل (سكرين محتمل / خروج من التاب) بتتحول سودة.
import { useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useScreenshotGuard } from "@/lib/screenshot-guard";

export function PrivateImage({ src, className = "" }: { src: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const covered = useScreenshotGuard(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let dead = false;
    setState("loading");
    (async () => {
      try {
        const r = await fetch(src, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) throw new Error("bad status");
        const bmp = await createImageBitmap(await r.blob());
        if (dead) return;
        setSize({ w: bmp.width, h: bmp.height });
        // بنستنى الـ canvas ياخد مقاسه وبعدين نرسم
        requestAnimationFrame(() => {
          const c = ref.current;
          if (!c || dead) return;
          c.width = bmp.width;
          c.height = bmp.height;
          c.getContext("2d")?.drawImage(bmp, 0, 0);
          setState("ready");
        });
      } catch { if (!dead) setState("error"); }
    })();
    return () => { dead = true; };
  }, [src]);

  return (
    <span className="relative inline-block bg-black align-top select-none" style={{ lineHeight: 0 }} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={ref}
        className={`private-canvas ${className}`}
        style={{ visibility: covered || state !== "ready" ? "hidden" : "visible", aspectRatio: size ? `${size.w} / ${size.h}` : "4 / 3", width: size ? undefined : "12rem" }}
      />
      {(covered || state !== "ready") && (
        <span className="absolute inset-0 flex items-center justify-center bg-black text-white/50" style={{ lineHeight: 1 }}>
          {state === "loading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-6 w-6" />}
        </span>
      )}
    </span>
  );
}
