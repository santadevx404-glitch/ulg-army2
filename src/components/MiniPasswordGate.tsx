import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";

export function MiniPasswordGate({
  title,
  wrongPassword,
  onSubmit,
}: {
  title: string;
  wrongPassword: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    onSubmit(password);
    setSubmitting(false);
  };

  return (
    <div className="p-10 text-center">
      <Lock className="h-10 w-10 mx-auto text-[var(--gold)] mb-4" />
      <h2 className="text-xl font-bold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-6">هذا المحتوى محمي بكلمة سر.</p>
      <form onSubmit={submit} className="space-y-3 max-w-xs mx-auto">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input text-center"
          placeholder="كلمة السر"
        />
        {wrongPassword && <p className="text-sm text-destructive">كلمة السر غلط</p>}
        <button type="submit" disabled={submitting} className="btn-gold ripple w-full inline-flex items-center justify-center gap-2 disabled:opacity-50">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "دخول"}
        </button>
      </form>
    </div>
  );
}
