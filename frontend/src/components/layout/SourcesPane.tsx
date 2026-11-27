import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDocuments } from '../../lib/api';
import { setSelectedSources, useSelectedSources } from '../../lib/sourceSelection';
import { useLayout } from '../../lib/layout';
import { IconClose } from '../icons';
import type { DocumentItem } from '../../lib/types';

function naturalKey(s: string) {
  return s
    .toLowerCase()
    .split(/(\d+)/)
    .map((t) => (/^\d+$/.test(t) ? t.padStart(8, '0') : t))
    .join('');
}

export function fileNameOf(path: string) {
  return path.split('/').pop() || path;
}

export function groupOf(doc: DocumentItem) {
  const n = `${doc.title ?? ''} ${doc.source_path}`.toLowerCase();
  if (/module\s*\d+/.test(n)) return 'Module decks';
  if (/\blab(?:\b|[_-])/.test(n)) return 'Lab';
  return 'Documents';
}

export function isModuleDoc(doc: DocumentItem) {
  return groupOf(doc) === 'Module decks';
}

export default function SourcesPane() {
  const selected = useSelectedSources();
  const { peek, setPeek } = useLayout();
  const [filter, setFilter] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    staleTime: 60_000,
    retry: false,
  });

  const docs = useMemo(
    () => [...(data?.documents ?? [])].sort((a, b) => naturalKey(fileNameOf(a.source_path)).localeCompare(naturalKey(fileNameOf(b.source_path)))),
    [data],
  );
  const known = useMemo(() => new Set(docs.map((d) => d.id)), [docs]);
  const active = data ? selected.filter((id) => known.has(id)) : selected;

  useEffect(() => {
    if (data && active.length !== selected.length) setSelectedSources(active);
  }, [data, active, selected.length]);

  const isAll = active.length === 0;
  const shown = docs.filter((d) => (d.title || d.source_path).toLowerCase().includes(filter.toLowerCase()));

  const toggle = (id: string) => {
    if (isAll) {
      setSelectedSources(docs.map((d) => d.id).filter((x) => x !== id));
      return;
    }
    if (active.includes(id)) {
      const next = active.filter((x) => x !== id);
      setSelectedSources(next);
      return;
    }
    const next = [...active, id];
    setSelectedSources(next.length === docs.length ? [] : next);
  };

  const groups = useMemo(() => {
    const order = ['Module decks', 'Documents', 'Lab'];
    const map = new Map<string, DocumentItem[]>();
    for (const d of shown) {
      const g = groupOf(d);
      const list = map.get(g) ?? [];
      list.push(d);
      map.set(g, list);
    }
    return order.filter((g) => map.has(g)).map((g) => ({ label: g, items: map.get(g)! }));
  }, [shown]);

  const checkedCount = isAll ? docs.length : active.length;

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="source-picker">
      {peek && (
        <div
          className="mx-3 mt-3 p-3 rounded-[10px] border"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
          role="region"
          aria-label="Source excerpt"
        >
          <div className="flex items-start gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <span className="pill badge-accent">{peek.n}</span>
              <strong className="block mt-1.5 text-[12.5px] leading-snug">
                {peek.source.document_title || fileNameOf(peek.source.source_path)}
              </strong>
              <span className="block text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                {fileNameOf(peek.source.source_path)}
                {peek.source.page_numbers?.length ? ` · p. ${peek.source.page_numbers.join(', ')}` : ''}
              </span>
            </div>
            <button type="button" className="icon-btn" aria-label="Close excerpt" onClick={() => setPeek(null)}>
              <IconClose />
            </button>
          </div>
          <p className="m-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {peek.source.snippet || peek.source.chunk_summary || 'No excerpt is stored for this source.'}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5 pb-2">
        <button type="button" className="text-xs font-semibold px-1.5 py-1 rounded" style={{ color: 'var(--accent)' }} onClick={() => setSelectedSources([])}>
          Select all
        </button>
        <button
          type="button"
          className="text-xs font-semibold px-1.5 py-1 rounded"
          style={{ color: 'var(--accent)' }}
          onClick={() => {
            const ids = docs.filter(isModuleDoc).map((d) => d.id);
            setSelectedSources(ids.length && ids.length < docs.length ? ids : []);
          }}
        >
          Modules only
        </button>
        <button type="button" className="text-xs font-semibold px-1.5 py-1 rounded" style={{ color: 'var(--accent)' }} onClick={() => setSelectedSources([])}>
          Use all
        </button>
        <span className="ml-auto text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          {docs.length ? `${checkedCount} of ${docs.length}` : '—'}
        </span>
      </div>

      <div className="relative px-3 pb-2">
        <span className="absolute left-[22px] top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </span>
        <input
          className="field"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter source files"
        />
      </div>

      <div className="scroll-thin flex-1 pb-3">
        {isLoading && <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-faint)' }}>Loading documents…</p>}
        {isError && <p className="px-4 py-3 text-xs" style={{ color: 'var(--danger)' }}>Could not load documents.</p>}
        {!isLoading && !isError && shown.length === 0 && (
          <p className="px-4 py-3 text-xs" style={{ color: 'var(--text-faint)' }}>
            {docs.length ? 'No files match.' : 'No documents in the library yet.'}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="flex justify-between px-3.5 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
              <span>{g.label}</span>
              <span>{g.items.length}</span>
            </div>
            {g.items.map((d) => {
              const checked = isAll || active.includes(d.id);
              const name = fileNameOf(d.source_path);
              return (
                <label
                  key={d.id}
                  className="src-row flex items-start gap-2.5 mx-1.5 my-px px-2 py-2 rounded-md cursor-pointer"
                >
                  <input
                    className="src-check"
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(d.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium leading-snug break-words">{name}</span>
                    <span className="block text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                      {d.chunk_count} chunk{d.chunk_count === 1 ? '' : 's'}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function scopeLabel(selected: string[], total: number | undefined) {
  if (!total) return 'Searching your sources';
  if (selected.length === 0) return `Searching all ${total} sources`;
  return `Searching ${selected.length} of ${total} sources`;
}
