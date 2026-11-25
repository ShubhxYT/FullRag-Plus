import { useState } from 'react';
import { submitFeedback } from '../../lib/api';
import type { ChatTurn } from '../../lib/useChat';
import type { Source } from '../../lib/types';
import MarkdownAnswer from './MarkdownAnswer';

interface Props {
  turn: ChatTurn;
  isLast: boolean;
  onRetry: (id: string) => void;
  onFeedback: (id: string, f: 'thumbs_up' | 'thumbs_down') => void;
}

function fileName(s: Source) {
  return s.source_path.split('/').pop() || s.source_path;
}

function SourceList({ turnId, sources, highlight }: { turnId: string; sources: Source[]; highlight: number | null }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!sources.length) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2 text-slate-500">
        <span className="material-symbols-outlined text-sm">database</span>
        <span className="text-[10px] font-bold font-headline tracking-widest uppercase">
          Sources ({sources.length})
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 items-start">
        {sources.map((s, i) => {
          const n = i + 1;
          const expanded = open === n || highlight === n;
          return (
            <li
              key={i}
              id={`${turnId}-src-${n}`}
              className={`rounded-xl border px-3 py-2 transition-colors ${
                highlight === n
                  ? 'border-indigo-400/60 bg-indigo-500/10'
                  : 'border-white/5 bg-slate-900/60 hover:border-indigo-500/30'
              }`}
            >
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : n)}
                className="w-full flex items-center gap-2 text-left"
                aria-expanded={expanded}
              >
                <span className="cite-chip shrink-0">{n}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-slate-200 font-medium truncate">
                    {s.document_title || fileName(s)}
                  </span>
                  <span className="block text-[10px] text-slate-500 truncate">
                    {fileName(s)}
                    {s.page_numbers?.length ? ` · p. ${s.page_numbers.join(', ')}` : ''}
                  </span>
                </span>
                <span className="text-[10px] text-slate-500 shrink-0" title="Similarity to your question">
                  {(s.similarity_score * 100).toFixed(0)}%
                </span>
              </button>
              {expanded && (s.snippet || s.chunk_summary) && (
                <p className="mt-2 text-xs text-slate-400 leading-relaxed border-t border-white/5 pt-2">
                  {s.snippet || s.chunk_summary}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ChatTurnView({ turn, isLast, onRetry, onFeedback }: Props) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);

  const cite = (n: number) => {
    setHighlight(n);
    document.getElementById(`${turn.id}-src-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => setHighlight((h) => (h === n ? null : h)), 2500);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const feedback = async (type: 'thumbs_up' | 'thumbs_down') => {
    onFeedback(turn.id, type);
    setFeedbackError(false);
    try {
      await submitFeedback({ query_log_id: turn.queryLogId ?? null, feedback_type: type, query_text: turn.question });
    } catch {
      setFeedbackError(true);
    }
  };

  const streaming = turn.status === 'streaming';
  const avgScore = turn.sources.length
    ? Math.round((turn.sources.reduce((a, s) => a + s.similarity_score, 0) / turn.sources.length) * 100)
    : null;

  return (
    <article className="space-y-4" aria-busy={turn.status === 'searching' || streaming}>
      {/* Question */}
      <div className="flex justify-end">
        <div className="max-w-[90%] md:max-w-[75%] bg-indigo-600/20 border border-indigo-500/20 text-slate-100 rounded-2xl rounded-tr-md px-4 py-3 text-[15px] whitespace-pre-wrap break-words">
          {turn.question}
        </div>
      </div>

      {/* Answer */}
      <div className="bg-slate-900/40 border border-white/5 backdrop-blur-sm rounded-2xl rounded-tl-md p-4 md:p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
            <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
              auto_awesome
            </span>
          </span>
          <span className="text-xs font-headline font-bold text-slate-300">FullRag</span>
          {turn.status === 'searching' && (
            <span className="text-xs text-slate-500 flex items-center gap-1" role="status">
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              Searching your documents…
            </span>
          )}
          {streaming && !turn.answer && (
            <span className="text-xs text-slate-500" role="status">
              Found {turn.sources.length} source{turn.sources.length === 1 ? '' : 's'}, writing answer…
            </span>
          )}
          {avgScore !== null && turn.status === 'done' && (
            <span
              className="ml-auto text-[10px] font-bold uppercase tracking-widest text-emerald-400/90 bg-emerald-950/30 border border-emerald-500/20 rounded-full px-2 py-0.5"
              title="Average similarity of the retrieved sources"
            >
              {avgScore}% match
            </span>
          )}
        </div>

        {turn.status === 'searching' && (
          <div className="space-y-2 animate-pulse" aria-hidden>
            <div className="h-3 bg-slate-800 rounded w-11/12" />
            <div className="h-3 bg-slate-800 rounded w-4/5" />
            <div className="h-3 bg-slate-800 rounded w-2/3" />
          </div>
        )}

        {turn.answer && (
          <MarkdownAnswer text={turn.answer} sources={turn.sources} streaming={streaming} onCite={cite} />
        )}

        {turn.status === 'error' && (
          <div role="alert" className="mt-2 rounded-xl bg-red-950/30 border border-red-500/20 p-4">
            <p className="font-headline font-bold text-red-300 text-sm mb-1">Couldn&apos;t answer that</p>
            <p className="text-sm text-red-400 break-words">{turn.error}</p>
            <button
              onClick={() => onRetry(turn.id)}
              className="mt-3 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest bg-red-900/40 hover:bg-red-900/60 text-red-200"
            >
              Try again
            </button>
          </div>
        )}

        {turn.status === 'stopped' && (
          <p className="mt-3 text-xs text-slate-500 flex items-center gap-2">
            Stopped.
            <button onClick={() => onRetry(turn.id)} className="text-indigo-300 hover:text-indigo-200 font-semibold">
              Regenerate
            </button>
          </p>
        )}

        <SourceList turnId={turn.id} sources={turn.sources} highlight={highlight} />

        {turn.status === 'done' && (
          <div className="mt-4 pt-3 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-slate-500 uppercase tracking-widest font-label">
            {turn.latency && <span>{(turn.latency.total_ms / 1000).toFixed(1)}s</span>}
            {turn.model && <span className="normal-case tracking-normal">{turn.model}</span>}
            <span className="ml-auto flex items-center gap-1 normal-case tracking-normal">
              <button
                onClick={copy}
                className="p-1.5 rounded-lg hover:bg-slate-800/60 hover:text-slate-200"
                title="Copy answer"
                aria-label="Copy answer"
              >
                <span className="material-symbols-outlined text-base">{copied ? 'check' : 'content_copy'}</span>
              </button>
              {isLast && (
                <button
                  onClick={() => onRetry(turn.id)}
                  className="p-1.5 rounded-lg hover:bg-slate-800/60 hover:text-slate-200"
                  title="Regenerate"
                  aria-label="Regenerate answer"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                </button>
              )}
              <button
                onClick={() => feedback('thumbs_up')}
                disabled={!!turn.feedback}
                className={`p-1.5 rounded-lg hover:bg-slate-800/60 disabled:cursor-default ${turn.feedback === 'thumbs_up' ? 'text-emerald-400' : 'hover:text-emerald-400'}`}
                aria-label="Helpful"
                title="Helpful"
              >
                <span className="material-symbols-outlined text-base" style={turn.feedback === 'thumbs_up' ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_up</span>
              </button>
              <button
                onClick={() => feedback('thumbs_down')}
                disabled={!!turn.feedback}
                className={`p-1.5 rounded-lg hover:bg-slate-800/60 disabled:cursor-default ${turn.feedback === 'thumbs_down' ? 'text-red-400' : 'hover:text-red-400'}`}
                aria-label="Not helpful"
                title="Not helpful"
              >
                <span className="material-symbols-outlined text-base" style={turn.feedback === 'thumbs_down' ? { fontVariationSettings: "'FILL' 1" } : undefined}>thumb_down</span>
              </button>
              {feedbackError && <span className="text-red-400">feedback not saved</span>}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
