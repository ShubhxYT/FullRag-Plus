import { useEffect, useLayoutEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ask, newConversation, retry, saveScroll, setActive, setFeedback, stop } from '../lib/chatStore';
import { useConversation } from '../lib/useChatStore';
import ChatTurnView from '../components/chat/ChatTurnView';
import Composer from '../components/chat/Composer';
import { useLayout } from '../lib/layout';

const SUGGESTIONS = [
  'List the main topics in my documents',
  'Give me an overview of every document',
  'What should I revise first?',
  'Summarise the key definitions',
];

function nearBottom(el: HTMLElement, px = 240) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - px;
}

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { conversation, busy } = useConversation(id);
  const { setPeek, openPanel } = useLayout();
  const turns = conversation?.turns ?? [];
  const last = turns[turns.length - 1];
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversation) setActive(conversation.id);
  }, [conversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const restored = useRef(false);
  useLayoutEffect(() => {
    restored.current = false;
  }, [conversation?.id]);

  useLayoutEffect(() => {
    if (!conversation || restored.current || !threadRef.current) return;
    restored.current = true;
    const el = threadRef.current;
    el.scrollTop = conversation.scrollY ?? el.scrollHeight;
  }, [conversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id || !threadRef.current) return;
    const el = threadRef.current;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => saveScroll(id, el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [id]);

  const turnCount = useRef(turns.length);
  const firstRun = useRef(true);
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const el = threadRef.current;
    if (!el) return;
    const grew = turns.length > turnCount.current;
    turnCount.current = turns.length;
    if (grew || (busy && nearBottom(el))) {
      el.scrollTo({ top: el.scrollHeight, behavior: grew ? 'smooth' : 'auto' });
    }
  }, [turns.length, last?.answer, last?.status, last?.sources.length, busy]);

  if (id && !conversation) return <Navigate to="/" replace />;

  const start = (q?: string) => {
    if (!q) return;
    const newId = newConversation(q);
    navigate(`/chat/${newId}`);
  };

  const submit = (q: string) => {
    if (conversation) ask(conversation.id, q);
    else start(q);
  };

  const model = [...turns].reverse().find((t) => t.model)?.model ?? null;

  return (
    <>
      <div className="scroll-thin flex-1 min-h-0 pt-7" ref={threadRef} id="chat-thread">
        {!id || turns.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 pb-20 gap-2.5">
            <h2 className="m-0 text-[28px] font-semibold tracking-tight max-[760px]:text-[22px]">Ask your notes</h2>
            <p className="m-0 mb-3 max-w-md" style={{ color: 'var(--text-muted)' }}>
              Search across the documents in your library. Answers come with citations you can open.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-[560px]">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => start(s)}
                  className="px-3 py-2 rounded-full text-[13px] border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--text-muted)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-[760px] mx-auto px-7 max-[760px]:px-4 pb-9 space-y-7">
            {turns.map((t, i) => (
              <ChatTurnView
                key={t.id}
                turn={t}
                isLast={i === turns.length - 1}
                onRetry={(turnId) => conversation && retry(conversation.id, turnId)}
                onFeedback={(turnId, f) => conversation && setFeedback(conversation.id, turnId, f)}
                onCite={(n, source) => {
                  setPeek({ n, source });
                  openPanel('sources');
                }}
              />
            ))}
          </div>
        )}
      </div>
      <Composer
        onSubmit={submit}
        currentQuestion={last?.status === 'done' ? last.question : undefined}
        busy={busy}
        onStop={conversation ? () => stop(conversation.id) : undefined}
        placeholder={turns.length ? 'Ask a follow-up, or a new question…' : 'Ask anything about your documents…'}
        model={model}
      />
    </>
  );
}
