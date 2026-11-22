// صورة بروفايل (أو أول حرف من الاسم لو مفيش صورة).
/** تاج مايل فوق صورة صاحب الموقع */
function Crown({ size }: { size: number }) {
  const w = Math.max(12, Math.round(size * 0.34));
  return (
    <svg
      viewBox="0 0 24 24" width={w} height={w} aria-label="صاحب الموقع"
      className="absolute drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] pointer-events-none"
      style={{ top: size * 0.146 - w * 0.35, right: size * 0.146 - w * 0.35, transform: "rotate(40deg)" }}
    >
      <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" fill="#f5c518" stroke="#8a6d00" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="3" cy="8" r="1.6" fill="#f5c518" stroke="#8a6d00" strokeWidth="1" />
      <circle cx="12" cy="4.6" r="1.6" fill="#f5c518" stroke="#8a6d00" strokeWidth="1" />
      <circle cx="21" cy="8" r="1.6" fill="#f5c518" stroke="#8a6d00" strokeWidth="1" />
    </svg>
  );
}

export function Avatar({ name, src, size = 40, owner = false }: { name: string; src?: string | null; size?: number; owner?: boolean }) {
  const inner = <AvatarBody name={name} src={src} size={size} />;
  if (!owner) return inner;
  return <span className="relative inline-block shrink-0 align-middle" style={{ width: size, height: size }}>{inner}<Crown size={size} /></span>;
}

function AvatarBody({ name, src, size }: { name: string; src?: string | null; size: number }) {
  const letter = (name || "؟").trim().charAt(0) || "؟";
  if (src) {
    return (
      <img
        src={`/api/avatar/${src}`}
        alt=""
        draggable={false}
        className="rounded-full object-cover shrink-0 border border-border bg-black/30"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-bold bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/30"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {letter}
    </div>
  );
}
