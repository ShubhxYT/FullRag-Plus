import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ask,
  clearActive,
  newConversation,
  retry,
  saveScroll,
  setActive,
  setFeedback,
  stop,
} from '../lib/chatStore';
import { useConversation } from '../lib/useChatStore';
import ChatTurnView from '../components/chat/ChatTurnView';
import FollowUpInput from '../components/results/FollowUpInput';

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

function nearBottom(px = 240) {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - px;
}

/** One saved conversation (/chat/:id): restored exactly, continued with follow-ups. */
export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { conversation, busy } = useConversation(id);
  const turns = conversation?.turns ?? [];
  const last = turns[turns.length - 1];

  useEffect(() => {
    if (conversation) setActive(conversation.id);
  }, [conversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the scroll position from the last visit (default: the bottom),
  // and remember it while reading.
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!conversation || restored.current) return;
    restored.current = true;
    const y = conversation.scrollY;
    window.scrollTo(0, y ?? document.documentElement.scrollHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  useEffect(() => {
    if (!id) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => saveScroll(id, window.scrollY));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [id]);

  // Scroll to a newly asked question; keep following a streaming answer
  // only while the reader is already at the bottom.
  const bottomRef = useRef<HTMLDivElement>(null);
  const turnCount = useRef(turns.length);
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const grew = turns.length > turnCount.current;
    turnCount.current = turns.length;
    if (grew || (busy && nearBottom())) {
      bottomRef.current?.scrollIntoView({ behavior: grew ? 'smooth' : 'auto', block: 'end' });
    }
  }, [turns.length, last?.answer, last?.status, last?.sources.length, busy]);

  if (!id || !conversation) return <Navigate to="/" replace />;

  const startNew = (q?: string) => {
    if (q) {
      const newId = newConversation(q);
      navigate(`/chat/${newId}`);
    } else {
      clearActive();
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
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[20%] -right-[10%] w-[60%] h-[60%] bg-indigo-900/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -left-[5%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-4 w-full sticky top-14 md:top-0 z-40 bg-slate-950/70 backdrop-blur-xl border-b border-white/5">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm md:text-base font-headline font-bold text-slate-100 truncate" title={conversation.title}>
            {conversation.title}
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">
            {turns.length} question{turns.length === 1 ? '' : 's'} · saved in this browser
          </p>
        </div>
        <button
          onClick={() => navigate('/history')}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold font-headline text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
          title="All conversations"
        >
          <span className="material-symbols-outlined text-base">history</span>
          <span className="hidden sm:inline">History</span>
        </button>
        <button
          onClick={() => startNew()}
          className="shrink-0 flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-xl text-xs font-bold font-headline text-slate-200 bg-slate-800/60 hover:bg-slate-700/60 border border-white/5"
          title="Start a new conversation"
        >
          <span className="material-symbols-outlined text-base">add_comment</span>
          <span className="hidden sm:inline">New chat</span>
        </button>
      </header>

      <main className="max-w-4xl mx-auto w-full px-4 md:px-8 py-6 md:py-10 flex-grow relative z-10">
        {turns.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <span className="material-symbols-outlined text-4xl text-indigo-400 mb-3 block">forum</span>
            <p className="font-headline font-bold text-lg mb-2 text-slate-200">Ask your documents anything</p>
            <p className="text-sm">Type a question below to start.</p>
          </div>
        ) : (
          <div className="space-y-8 md:space-y-10">
            {turns.map((t, i) => (
              <ChatTurnView
                key={t.id}
                turn={t}
                isLast={i === turns.length - 1}
                onRetry={(turnId) => retry(conversation.id, turnId)}
                onFeedback={(turnId, f) => setFeedback(conversation.id, turnId, f)}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} className="h-2" />
      </main>

      <FollowUpInput
        onSubmit={(q) => ask(conversation.id, q)}
        currentQuestion={last?.status === 'done' ? last.question : undefined}
        busy={busy}
        onStop={() => stop(conversation.id)}
        placeholder={turns.length ? 'Ask a follow-up question…' : 'Ask a question…'}
      />
    </motion.div>
  );
}
