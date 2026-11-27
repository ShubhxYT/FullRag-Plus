import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDocuments } from '../../lib/api';
import { useSelectedSources } from '../../lib/sourceSelection';
import { useLayout } from '../../lib/layout';
import { scopeLabel } from '../layout/SourcesPane';
import { IconSend, IconStop } from '../icons';

const followUps: { label: string; build: (q: string) => string }[] = [
  { label: 'Explain in detail', build: (q) => `Explain in detail: ${q}` },
  { label: 'Show related topics', build: (q) => `What topics are related to: ${q}` },
  { label: 'Compare approaches', build: (q) => `Compare the different approaches to: ${q}` },
];

interface Props {
  onSubmit: (query: string) => void;
  currentQuestion?: string;
  busy?: boolean;
  onStop?: () => void;
  placeholder?: string;
  model?: string | null;
}

export default function Composer({ onSubmit, currentQuestion, busy, onStop, placeholder, model }: Props) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const selected = useSelectedSources();
  const { openPanel, setTab } = useLayout();
  const { data } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    onSubmit(q);
    setQuery('');
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.style.height = 'auto';
      }
    });
  };

  return (
    <div className="composer-wrap">
      <form className="max-w-[760px] mx-auto" onSubmit={submit} autoComplete="off">
        {currentQuestion && !busy && (
          <div className="hidden md:flex flex-wrap justify-center gap-2 pb-2">
            {followUps.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => onSubmit(s.build(currentQuestion))}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-full border"
                style={{ color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div className="composer-box">
          <textarea
            ref={ref}
            rows={1}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resize();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder ?? 'Ask a follow-up, or a new question…'}
            aria-label="Message"
          />
          {busy ? (
            <button type="button" className="send-btn" aria-label="Stop generating" title="Stop" onClick={onStop}>
              <IconStop className="icon-lg" />
            </button>
          ) : (
            <button type="submit" className="send-btn" aria-label="Send" disabled={!query.trim()}>
              <IconSend className="icon-lg" />
            </button>
          )}
        </div>
        <div className="flex justify-between gap-3 pt-2 px-1.5 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          <button
            type="button"
            className="text-left hover:underline"
            style={{ color: selected.length ? 'var(--accent)' : 'var(--text-faint)' }}
            onClick={() => {
              setTab('sources');
              openPanel('sources');
            }}
          >
            {scopeLabel(selected, data?.total)}
          </button>
          {model ? <span className="font-medium">{model}</span> : <span />}
        </div>
      </form>
    </div>
  );
}
