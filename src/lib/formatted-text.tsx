import type { ReactNode } from "react";

// بيدعم: __نص__ = تسطير، **نص** = عريض، **__نص__** أو __**نص**__ = عريض + تسطير
const TOKEN_REGEX = /\*\*__(.+?)__\*\*|__\*\*(.+?)\*\*__|\*\*(.+?)\*\*|__(.+?)__/g;

function renderLine(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  const regex = new RegExp(TOKEN_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (match[1] !== undefined || match[2] !== undefined) {
      nodes.push(
        <strong key={key}>
          <u>{match[1] ?? match[2]}</u>
        </strong>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<u key={key}>{match[4]}</u>);
    }
    lastIndex = regex.lastIndex;
    // منع اللوب اللانهائي لو match فاضي
    if (match[0].length === 0) regex.lastIndex++;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * بيعرض نص عادي مع دعم تنسيق بسيط:
 * __نص__ → تسطير
 * **نص** → عريض (Bold)
 * **__نص__** → عريض + تسطير مع بعض
 * وبيحافظ على فواصل الأسطر (Enter) كـ فقرات منفصلة.
 */
export function FormattedText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {renderLine(line, `l${i}`)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
