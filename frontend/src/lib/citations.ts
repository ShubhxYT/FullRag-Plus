import type { Source } from './types';

/**
 * Normalise the citation styles different backends/models produce into
 * markdown links "[n](#cite-n)" that the answer renderer turns into chips:
 *   [1]  [1, 2]  【1†L2-L3】  [Source 2: Title, Page 3]  [Source: Title, Page 3]
 * Also drops a trailing "Sources:" list (older prompt) since the UI lists
 * sources itself. Code spans/blocks are left untouched.
 */
export function prepareAnswer(text: string, sources: Source[]): string {
  let body = text.replace(/\n+\s*(?:#{1,6}\s*)?(?:\*\*)?Sources?:?(?:\*\*)?:?\s*\n(?:\s*(?:[-*•]|\d+\.)?\s*\[?Source[^\n]*\n?)+\s*$/i, '\n');

  const titleIndex = (label: string): number | null => {
    const l = label.trim().toLowerCase();
    const i = sources.findIndex((s) => {
      const t = (s.document_title || '').toLowerCase();
      const f = (s.source_path.split('/').pop() || '').toLowerCase();
      return (t && (l.startsWith(t) || t.startsWith(l))) || (f && l.startsWith(f));
    });
    return i >= 0 ? i + 1 : null;
  };

  const link = (n: number) => (n >= 1 && n <= Math.max(sources.length, 1) ? `[${n}](#cite-${n})` : `[${n}]`);

  // Split on code fences / inline code so we don't rewrite inside them.
  const parts = body.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  body = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        // models sometimes put HTML line breaks in table cells
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/【\s*(?:Source\s*)?(\d+)[^】]*】/g, (_, n) => link(Number(n)))
        .replace(/\[Source\s+(\d+)(?::[^\]]*)?\]/gi, (_, n) => link(Number(n)))
        .replace(/\[Source:\s*([^\]]+)\]/gi, (m, label: string) => {
          const n = titleIndex(label.split(',')[0]);
          return n ? link(n) : m;
        })
        .replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (_, list: string) =>
          list
            .split(',')
            .map((n) => link(Number(n.trim())))
            .join(''),
        );
    })
    .join('');
  return body.trim();
}
