import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { IconCheck, IconCopy, IconInfo, IconRefresh, IconThumbDown, IconThumbUp } from '../icons';
import { submitFeedback } from '../../lib/api';
import type { ChatTurn } from '../../lib/chatStore';
import type { Source } from '../../lib/types';
import { useDocumentPaths } from '../../lib/useDocumentPaths';
import MarkdownAnswer from './MarkdownAnswer';

interface Props {
  turn: ChatTurn;
  isLast: boolean;
  onRetry: (id: string) => void;
  onFeedback: (id: string, f: 'thumbs_up' | 'thumbs_down') => void;
  onCite?: (n: number, source: Source) => void;
}

function fileName(s: Source) {
  return s.source_path.split('/').pop() || s.source_path;
}

function SourceList({ turnId, sources, highlight }: { turnId: string; sources: Source[]; highlight: number | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const existing = useDocumentPaths(sources.length > 0);
  if (!sources.length) return null;
  return (
    <div className="mt-5">
      <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-faint)' }}>
        <span className="text-[11px] font-semibold tracking-wide uppercase">
          Sources ({sources.length})
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 items-start">
        {sources.map((s, i) => {
          const n = i + 1;
          const expanded = open === n || highlight === n;
          const deleted = existing !== null && !existing.has(s.source_path);
          return (
            <li
              key={i}
              id={`${turnId}-src-${n}`}
              data-deleted={deleted || undefined}
              className={`rounded-xl border px-3 py-2 transition-colors ${deleted ? 'opacity-60' : ''}`}
              style={{
                borderColor: highlight === n ? 'var(--accent)' : 'var(--border)',
                background: highlight === n ? 'var(--accent-soft)' : 'var(--bg-elev)',
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : n)}
                className="w-full flex items-center gap-2 text-left"
                aria-expanded={expanded}
              >
                <span className="cite-chip shrink-0">{n}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium truncate">
                    {s.document_title || fileName(s)}
                  </span>
                  <span className="block text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>
                    {deleted ? (
                      <span title="This document was removed from the knowledge base" style={{ color: 'var(--warn)' }}>
                        Document deleted ·{' '}
                      </span>
                    ) : null}
                    {fileName(s)}
                    {s.page_numbers?.length ? ` · p. ${s.page_numbers.join(', ')}` : ''}
                  </span>
                </span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-faint)' }} title="Similarity to your question">
                  {(s.similarity_score * 100).toFixed(0)}%
                </span>
              </button>
              {expanded && (s.snippet || s.chunk_summary) && (
                <p className="mt-2 text-xs leading-relaxed border-t pt-2" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
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

export default function ChatTurnView({ turn, isLast, onRetry, onFeedback, onCite }: Props) {
  const [highlight, setHighlight] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackError, setFeedbackError] = useState(false);
  const queryClient = useQueryClient();

  const cite = (n: number) => {
    setHighlight(n);
    const source = turn.sources[n - 1];
    if (source && onCite) onCite(n, source);
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
      queryClient.invalidateQueries({ queryKey: ['evaluation'] });
    } catch {
      setFeedbackError(true);
    }
  };

  const streaming = turn.status === 'streaming';
  // Overview answers cite whole documents (no similarity score): no "% match".
  const avgScore = turn.sources.length && turn.sources.some((s) => s.similarity_score > 0)
    ? Math.round((turn.sources.reduce((a, s) => a + s.similarity_score, 0) / turn.sources.length) * 100)
    : null;

  return (
    <article className="mb-2" aria-busy={turn.status === 'searching' || streaming}>
      <div className="flex justify-end mb-4">
        <p className="user-bubble">{turn.question}</p>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          {turn.status === 'searching' && (
            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-muted)' }} role="status">
              {turn.progress || 'Searching your documents…'}
            </span>
          )}
          {streaming && !turn.answer && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }} role="status">
              Found {turn.sources.length} source{turn.sources.length === 1 ? '' : 's'}, writing answer…
            </span>
          )}
          {turn.documentIds?.length ? (
            <span className="pill badge-accent" title="Limited with the source picker">
              {turn.documentIds.length} selected source{turn.documentIds.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {turn.coverage && (turn.status === 'done' || streaming) && (
            <span
              className={`pill ${turn.coverage.covered < turn.coverage.total ? 'badge-warn' : 'badge-ok'}`}
              title={turn.coverage.missing.length ? `Not included: ${turn.coverage.missing.join(', ')}` : 'Every document was included'}
            >
              <IconCheck size={14} className="icon" />
              Covered {turn.coverage.covered} of {turn.coverage.total} documents
            </span>
          )}
          {turn.status === 'done' && (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {turn.model ? `${turn.model}` : ''}
              {turn.model && turn.latency ? ' · ' : ''}
              {turn.latency ? `${(turn.latency.total_ms / 1000).toFixed(0)}s` : ''}
            </span>
          )}
          {avgScore !== null && turn.status === 'done' && (
            <span className="ml-auto text-[11px]" style={{ color: 'var(--text-faint)' }} title="Average similarity of the retrieved sources">
              {avgScore}% match
            </span>
          )}
        </div>

        {turn.status === 'searching' && (
          <div className="space-y-2 animate-pulse" aria-hidden>
            <div className="h-3 rounded w-11/12" style={{ background: 'var(--bg-hover)' }} />
            <div className="h-3 rounded w-4/5" style={{ background: 'var(--bg-hover)' }} />
            <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-hover)' }} />
          </div>
        )}

        {turn.answer && (
          <MarkdownAnswer text={turn.answer} sources={turn.sources} streaming={streaming} onCite={cite} />
        )}

        {turn.status === 'error' && (
          <div role="alert" className="mt-2 rounded-xl p-4" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <p className="font-semibold text-sm mb-1">Couldn&apos;t answer that</p>
            <p className="text-sm break-words">{turn.error}</p>
            <button
              onClick={() => onRetry(turn.id)}
              className="btn mt-3"
            >
              Try again
            </button>
          </div>
        )}

        {turn.status === 'stopped' && (
          <p className="mt-3 text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            Stopped.
            <button onClick={() => onRetry(turn.id)} className="font-semibold" style={{ color: 'var(--accent)' }}>
              Regenerate
            </button>
          </p>
        )}

        <SourceList turnId={turn.id} sources={turn.sources} highlight={highlight} />

        {turn.status === 'done' && turn.sources.length === 0 && (
          <p className="mt-4 text-xs flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
            <IconInfo className="icon" />
            No matching documents were found.
            <Link to="/library" className="underline underline-offset-2">
              Upload documents
            </Link>
            to get grounded answers.
          </p>
        )}

        {turn.status === 'done' && (
          <div className="mt-3 flex flex-wrap items-center gap-0.5">
            <button onClick={copy} className="icon-btn" title="Copy answer" aria-label="Copy answer">
              {copied ? <IconCheck className="icon" /> : <IconCopy className="icon" />}
            </button>
            {isLast && (
              <button onClick={() => onRetry(turn.id)} className="icon-btn" title="Regenerate" aria-label="Regenerate answer">
                <IconRefresh className="icon" />
              </button>
            )}
            <button
              onClick={() => feedback('thumbs_up')}
              disabled={!!turn.feedback}
              className="icon-btn"
              style={turn.feedback === 'thumbs_up' ? { color: 'var(--ok)', background: 'var(--ok-soft)' } : undefined}
              aria-label="Helpful"
              title="Helpful"
            >
              <IconThumbUp className="icon" />
            </button>
            <button
              onClick={() => feedback('thumbs_down')}
              disabled={!!turn.feedback}
              className="icon-btn"
              style={turn.feedback === 'thumbs_down' ? { color: 'var(--danger)', background: 'var(--danger-soft)' } : undefined}
              aria-label="Not helpful"
              title="Not helpful"
            >
              <IconThumbDown className="icon" />
            </button>
            {feedbackError && <span className="text-xs ml-2" style={{ color: 'var(--danger)' }}>feedback not saved</span>}
          </div>
        )}
      </div>
    </article>
  );
}
