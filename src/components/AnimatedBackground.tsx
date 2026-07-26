import { useEffect, useRef, useState } from "react";
import { usePerformanceMode } from "@/lib/performance-mode";

export function AnimatedBackground() {
  const { lite } = usePerformanceMode();
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lite) return;
    const onMove = (e: MouseEvent) => {
      setPos({ x: (e.clientX / window.innerWidth) * 100, y: (e.clientY / window.innerHeight) * 100 });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [lite]);

  if (lite) {
    // وضع الأجهزة الضعيفة: نسيب خلفية بسيطة وثابتة بس من غير جسيمات متحركة
    // ولا تدرّج بيتحرك مع الماوس، عشان نوفر معالجة ورسوميات.
    return <div className="mil-grid" />;
  }

  const particles = Array.from({ length: 18 });

  return (
    <>
      <div className="mil-grid" />
      <div
        ref={ref}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: `radial-gradient(600px circle at ${pos.x}% ${pos.y}%, oklch(0.78 0.14 85 / 10%), transparent 45%)`,
          transition: "background 0.15s ease-out",
        }}
      />
      {particles.map((_, i) => (
        <span
          key={i}
          className="particle"
          style={{
            left: `${(i * 5.5) % 100}%`,
            animationDuration: `${8 + (i % 6) * 2}s`,
            animationDelay: `${(i % 5) * 1.5}s`,
            opacity: 0.35 + ((i % 4) * 0.1),
          }}
        />
      ))}
    </>
  );
}
