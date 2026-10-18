// صورة بروفايل (أو أول حرف من الاسم لو مفيش صورة).
export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
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
