import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { prepareAnswer } from '../../lib/citations';
import type { Source } from '../../lib/types';

interface Props {
  text: string;
  sources: Source[];
  streaming?: boolean;
  onCite?: (n: number) => void;
}

function MarkdownAnswer({ text, sources, streaming, onCite }: Props) {
  const md = prepareAnswer(text, sources);
  return (
    <div className={`chat-markdown ${streaming ? 'is-streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const m = href?.match(/^#cite-(\d+)$/);
            if (m) {
              const n = Number(m[1]);
              const src = sources[n - 1];
              return (
                <button
                  type="button"
                  onClick={() => onCite?.(n)}
                  title={src ? src.document_title || src.source_path : `Source ${n}`}
                  className="cite-chip"
                >
                  {n}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          table({ children }) {
            return (
              <div className="table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownAnswer);
