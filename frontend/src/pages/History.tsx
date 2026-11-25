import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { clearActive, deleteConversation, renameConversation, setActive, type Conversation } from '../lib/chatStore';
import { useChatState } from '../lib/useChatStore';

function formatWhen(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const days = Math.floor((now.setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function Row({ conv, active }: { conv: Conversation; active: boolean }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conv.title);
  const [confirming, setConfirming] = useState(false);
  const questions = conv.turns.length;
  const lastQ = conv.turns[conv.turns.length - 1]?.question;

  const open = () => {
    setActive(conv.id);
    navigate(`/chat/${conv.id}`);
  };

  return (
    <li
      className={`group rounded-2xl border p-4 transition-colors ${
        active ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-white/5 bg-slate-900/50 hover:border-indigo-500/20'
      }`}
      data-testid="history-item"
    >
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-indigo-400 mt-0.5">forum</span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                renameConversation(conv.id, title);
                setEditing(false);
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setEditing(false), setTitle(conv.title))}
                aria-label="Conversation title"
                maxLength={80}
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:ring-1 focus:ring-indigo-500"
              />
              <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white">
                Save
              </button>
            </form>
          ) : (
            <button onClick={open} className="text-left w-full">
              <span className="block font-headline font-bold text-slate-100 truncate group-hover:text-white">
                {conv.title}
              </span>
              {lastQ && questions > 1 && (
                <span className="block text-xs text-slate-500 truncate mt-0.5">Last: {lastQ}</span>
              )}
            </button>
          )}
          <p className="mt-1 text-[10px] uppercase tracking-widest text-slate-500 flex flex-wrap gap-x-3">
            <span>{formatWhen(conv.updatedAt)}</span>
            <span>
              {questions} question{questions === 1 ? '' : 's'}
            </span>
            {active && <span className="text-indigo-300">Active</span>}
          </p>
        </div>
        {!editing && (
          <div className="flex items-center gap-1 shrink-0">
            {confirming ? (
              <>
                <button
                  onClick={() => deleteConversation(conv.id)}
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-900/60 text-red-200 hover:bg-red-800/70"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="px-2.5 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={open} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60" aria-label="Open conversation" title="Open">
                  <span className="material-symbols-outlined text-base">open_in_new</span>
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                  aria-label="Rename conversation"
                  title="Rename"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-slate-800/60"
                  aria-label="Delete conversation"
                  title="Delete"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function History() {
  const { conversations, activeId } = useChatState();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const saved = conversations.filter((c) => c.turns.length > 0);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return saved;
    return saved.filter(
      (c) => c.title.toLowerCase().includes(f) || c.turns.some((t) => t.question.toLowerCase().includes(f)),
    );
  }, [saved, filter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.4 } }}
      exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
      className="flex-1 p-4 md:p-10"
    >
      <div className="max-w-3xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold font-headline text-on-surface tracking-tight mb-1">History</h1>
            <p className="text-on-surface-variant text-sm">
              Your conversations are saved in this browser only. Pick one up where you left off.
            </p>
          </div>
          <button
            onClick={() => {
              clearActive();
              navigate('/');
            }}
            className="flex items-center justify-center gap-2 px-6 py-3 primary-gradient text-white rounded-full font-headline font-bold text-sm shadow-xl"
          >
            <span className="material-symbols-outlined text-base">add_comment</span>
            New chat
          </button>
        </header>

        {saved.length > 0 && (
          <div className="relative mb-4">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">search</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="w-full bg-slate-900/50 border border-slate-800/50 rounded-xl py-2.5 pl-12 pr-4 text-sm text-on-surface focus:ring-1 focus:ring-indigo-500 placeholder-slate-500"
            />
          </div>
        )}

        {saved.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <span className="material-symbols-outlined text-4xl mb-3 block">history</span>
            <p className="font-headline font-bold text-lg text-slate-300 mb-1">No conversations yet</p>
            <p className="text-sm">Ask something on Discover and it will show up here.</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-center py-10 text-slate-500 text-sm">No conversations match “{filter}”.</p>
        ) : (
          <ul className="space-y-3">
            {shown.map((c) => (
              <Row key={c.id} conv={c} active={c.id === activeId} />
            ))}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
