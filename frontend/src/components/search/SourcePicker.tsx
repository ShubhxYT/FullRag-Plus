import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchDocuments } from '../../lib/api';
import { setSelectedSources, useSelectedSources } from '../../lib/sourceSelection';

function naturalKey(s: string) {
  return s.toLowerCase().split(/(\d+)/).map((t) => (/^\d+$/.test(t) ? t.padStart(8, '0') : t)).join('');
}

/** "All sources ▾" button + popover with a checkbox per document. */
export default function SourcePicker({ align = 'left', direction = 'up' }: { align?: 'left' | 'center'; direction?: 'up' | 'down' }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const selected = useSelectedSources();
  const ref = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    staleTime: 60_000,
    retry: false,
  });

  const docs = useMemo(
    () => [...(data?.documents ?? [])].sort((a, b) => naturalKey(a.source_path).localeCompare(naturalKey(b.source_path))),
    [data],
  );
  const known = useMemo(() => new Set(docs.map((d) => d.id)), [docs]);
  // Forget documents that were deleted since they were picked.
  const active = data ? selected.filter((id) => known.has(id)) : selected;
  useEffect(() => {
    if (data && active.length !== selected.length) setSelectedSources(active);
  }, [data, active, selected.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = docs.filter((d) => (d.title || d.source_path).toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string) =>
    setSelectedSources(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);
  const label = active.length === 0 ? `All sources${data ? ` (${data.total})` : ''}` : `${active.length} of ${data?.total ?? '?'} sources`;

  return (
    <div ref={ref} className={`relative ${align === 'center' ? 'flex justify-center' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="source-picker"
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
          active.length ? 'text-indigo-200 border-indigo-500/40 bg-indigo-950/40' : 'text-slate-400 border-white/10 bg-slate-900/60 hover:text-slate-200'
        }`}
      >
        <span className="material-symbols-outlined text-sm">filter_list</span>
        {label}
        <span className="material-symbols-outlined text-sm">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose sources"
          className={`absolute z-50 ${direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} w-[min(92vw,26rem)] max-h-[60vh] flex flex-col bg-slate-900 border border-white/10 rounded-xl shadow-2xl text-left`}
        >
          <div className="p-3 border-b border-white/5 space-y-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter documents…"
              aria-label="Filter documents"
              className="w-full bg-slate-800 border-none rounded-lg text-sm text-white placeholder:text-slate-500 focus:ring-1 focus:ring-indigo-500"
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">
                {active.length ? `${active.length} selected` : 'Answering from all documents'}
              </span>
              <span className="flex gap-3">
                <button type="button" className="text-indigo-300 hover:underline" onClick={() => setSelectedSources(shown.map((d) => d.id))}>
                  Select {filter ? 'shown' : 'all'}
                </button>
                <button type="button" className="text-slate-400 hover:underline" onClick={() => setSelectedSources([])}>
                  Use all
                </button>
              </span>
            </div>
          </div>
          <ul className="overflow-y-auto p-2 space-y-0.5">
            {isLoading && <li className="text-xs text-slate-500 p-2">Loading documents…</li>}
            {isError && <li className="text-xs text-red-300 p-2">Could not load documents.</li>}
            {!isLoading && !isError && shown.length === 0 && <li className="text-xs text-slate-500 p-2">No documents.</li>}
            {shown.map((d) => (
              <li key={d.id}>
                <label className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-800/70 cursor-pointer text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={active.includes(d.id)}
                    onChange={() => toggle(d.id)}
                    className="mt-0.5 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  <span className="min-w-0 break-words">{d.source_path}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
