import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useChat } from '../lib/useChat';
import ChatTurnView from '../components/chat/ChatTurnView';
import FollowUpInput from '../components/results/FollowUpInput';

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } },
};

function nearBottom(px = 240) {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - px;
}

/**
 * Chat view. `/results?q=...` starts a conversation with that question (or
 * restores it after a reload); follow-ups continue it with history.
 */
export default function Results() {
  const [searchParams] = useSearchParams();
  const question = (searchParams.get('q') || '').trim();
  const navigate = useNavigate();
  const { turns, ask, retry, stop, reset, busy, setFeedback } = useChat();

  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!question || started.current === question) return;
    started.current = question;
    // Reload / back-navigation: the stored conversation already starts here.
    if (turns.length && turns[0].question === question) return;
    ask(question, { fresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question]);

  // Scroll to a newly asked question; keep following a streaming answer
  // only while the reader is already at the bottom.
  const bottomRef = useRef<HTMLDivElement>(null);
  const turnCount = useRef(turns.length);
  const last = turns[turns.length - 1];
  useLayoutEffect(() => {
    const grew = turns.length > turnCount.current;
    turnCount.current = turns.length;
    if (grew || nearBottom()) bottomRef.current?.scrollIntoView({ behavior: grew ? 'smooth' : 'auto', block: 'end' });
  }, [turns.length, last?.answer, last?.status, last?.sources.length]);

  const newConversation = (q?: string) => {
    if (q) {
      started.current = null;
      reset();
      navigate(`/results?q=${encodeURIComponent(q)}`);
    } else {
      reset();
      navigate('/');
    }
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex-1 flex flex-col relative z-10"
    >
      {/* Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-indigo-900/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-4 w-full sticky top-14 md:top-0 z-40 bg-slate-950/70 backdrop-blur-xl border-b border-white/5">
        <form
          className="relative flex-1 max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement;
            const value = input.value.trim();
            if (value) {
              newConversation(value);
              input.value = '';
            }
          }}
        >
          <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">search</span>
          <input
            name="q"
            aria-label="Start a new search"
            className="w-full bg-slate-900/50 border border-slate-800/50 rounded-xl py-2 pl-12 pr-4 text-sm text-on-surface focus:ring-1 focus:ring-indigo-500 focus:bg-slate-900 transition-all placeholder-slate-500"
            placeholder="New search…"
            type="text"
          />
        </form>
        <button
          onClick={() => newConversation()}
          className="shrink-0 flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs font-bold font-headline text-slate-300 bg-slate-800/60 hover:bg-slate-700/60 border border-white/5"
          title="Start a new conversation"
        >
          <span className="material-symbols-outlined text-base">add_comment</span>
          <span className="hidden sm:inline">New chat</span>
        </button>
      </header>

      {/* Conversation */}
      <main className="max-w-4xl mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex-grow relative z-10">
        {turns.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <span className="material-symbols-outlined text-4xl text-indigo-400 mb-3 block">forum</span>
            <p className="font-headline font-bold text-lg mb-2 text-slate-200">Ask your documents anything</p>
            <p className="text-sm">Type a question below to start a conversation.</p>
          </div>
        ) : (
          <div className="space-y-8 md:space-y-10">
            {turns.map((t, i) => (
              <ChatTurnView
                key={t.id}
                turn={t}
                isLast={i === turns.length - 1}
                onRetry={retry}
                onFeedback={setFeedback}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} className="h-2" />
      </main>

      <FollowUpInput
        onSubmit={(q) => ask(q)}
        currentQuestion={last?.status === 'done' ? last.question : undefined}
        busy={busy}
        onStop={stop}
        placeholder={turns.length ? 'Ask a follow-up question…' : 'Ask a question…'}
      />
    </motion.div>
  );
}
