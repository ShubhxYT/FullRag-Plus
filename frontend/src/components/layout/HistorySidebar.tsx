import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clearActive } from '../../lib/chatStore';
import { useChatState } from '../../lib/useChatStore';
import { useHealth } from '../../lib/useHealth';
import { useLayout } from '../../lib/layout';
import { useQuery } from '@tanstack/react-query';
import { fetchDocuments } from '../../lib/api';
import { IconLogo, IconPlus, IconSearch } from '../icons';

function dayGroup(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startY = startToday - 86400000;
  if (ts >= startToday) return 'Today';
  if (ts >= startY) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HistorySidebar() {
  const navigate = useNavigate();
  const { id: routeId } = useParams<{ id: string }>();
  const { conversations, activeId } = useChatState();
  const health = useHealth();
  const { closeDrawers, isMobile } = useLayout();
  const [filter, setFilter] = useState('');
  const { data: docs } = useQuery({ queryKey: ['documents'], queryFn: fetchDocuments, staleTime: 60_000, retry: false });
  const current = routeId || activeId;

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = conversations.filter((c) => c.turns.length > 0 && (!q || c.title.toLowerCase().includes(q)));
    const out: { label: string; items: typeof list }[] = [];
    for (const c of list) {
      const label = dayGroup(c.updatedAt);
      const last = out[out.length - 1];
      if (!last || last.label !== label) out.push({ label, items: [c] });
      else last.items.push(c);
    }
    return out;
  }, [conversations, filter]);

  const startNew = () => {
    clearActive();
    navigate('/');
    if (isMobile()) closeDrawers();
  };

  return (
    <aside className="history-sidebar" aria-label="Chat history">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div
          className="w-[30px] h-[30px] rounded-lg grid place-items-center shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          <IconLogo size={16} className="icon" />
        </div>
        <div>
          <div className="text-[15px] font-semibold leading-tight tracking-tight">FullRag</div>
          <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Ask your notes
          </div>
        </div>
      </div>

      <div className="px-3 pb-2.5">
        <button type="button" className="btn btn-primary w-full h-9" onClick={startNew}>
          <IconPlus />
          New chat
        </button>
      </div>

      <div className="relative px-3 pb-2.5">
        <IconSearch className="icon absolute left-[22px] top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
        <input
          className="field"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
        />
      </div>

      <div className="scroll-thin flex-1 pb-2">
        {grouped.length === 0 ? (
          <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-faint)' }}>
            {filter ? 'No conversations match.' : 'No conversations yet. Ask something to get started.'}
          </p>
        ) : (
          grouped.map((g) => (
            <div key={g.label}>
              <div
                className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-faint)' }}
              >
                {g.label}
              </div>
              {g.items.map((c) => {
                const active = c.id === current;
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={c.title}
                    onClick={() => {
                      navigate(`/chat/${c.id}`);
                      if (isMobile()) closeDrawers();
                    }}
                    className="hist-item w-[calc(100%-16px)] mx-2 my-px flex items-center px-2.5 py-2 rounded-md text-left text-[13px] font-medium truncate"
                    style={{
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >
                    <span className="truncate">{c.title}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="mt-auto px-3.5 py-3 border-t text-xs flex flex-col gap-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: health.state === 'ok' ? 'var(--ok)' : health.state === 'down' ? 'var(--danger)' : 'var(--warn)', boxShadow: '0 0 0 3px var(--ok-soft)' }}
          />
          <span>{health.state === 'ok' ? 'System healthy' : health.label}{typeof docs?.total === 'number' ? ` · ${docs.total} documents` : ''}</span>
        </div>
      </div>
    </aside>
  );
}
