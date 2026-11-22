// صورة بروفايل (أو أول حرف من الاسم لو مفيش صورة).
/** تاج على حافة الدايرة (فوق يمين): قاعدته مماسّة للدايرة وبيدخل جواها شوية */
function Crown({ size }: { size: number }) {
  const w = Math.max(12, Math.round(size * 0.36));
  const d = size * 0.1464; // بُعد نقطة الزاوية 45° على الحافة عن حرف المربع
  return (
    <svg
      viewBox="0 0 24 18" width={w} height={w * 0.75} aria-label="صاحب الموقع"
      className="absolute pointer-events-none drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.8)]"
      style={{ top: d - w * 0.75, right: d - w / 2, transformOrigin: "50% 100%", transform: "rotate(45deg) translateY(14%)" }}
    >
      <path d="M2 16V6l5.2 4.6L12 2l4.8 8.6L22 6v10z" fill="#f5c518" stroke="#7a5c00" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="2" y="13.2" width="20" height="2.8" fill="#d9a400" stroke="#7a5c00" strokeWidth="1" />
      <circle cx="2" cy="6" r="1.5" fill="#fff3b0" stroke="#7a5c00" strokeWidth="0.8" />
      <circle cx="12" cy="2" r="1.5" fill="#fff3b0" stroke="#7a5c00" strokeWidth="0.8" />
      <circle cx="22" cy="6" r="1.5" fill="#fff3b0" stroke="#7a5c00" strokeWidth="0.8" />
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
