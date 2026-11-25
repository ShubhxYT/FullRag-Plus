import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StreamUnsupportedError,
  getErrorMessage,
  streamQuery,
  submitQuery,
} from './api';
import type { ChatMessage, LatencyBreakdown, Source } from './types';

export type TurnStatus = 'searching' | 'streaming' | 'done' | 'error' | 'stopped';

export interface ChatTurn {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  status: TurnStatus;
  error?: string;
  latency?: LatencyBreakdown;
  model?: string | null;
  queryLogId?: string | null;
  feedback?: 'thumbs_up' | 'thumbs_down';
}

const STORAGE_KEY = 'fullrag.chat.v1';
const MAX_HISTORY_TURNS = 3; // question+answer pairs sent as context
const MAX_HISTORY_CHARS = 2000;

// Once we learn the backend has no streaming endpoint, stop trying it.
let streamingSupported = true;

function loadTurns(): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const turns = JSON.parse(raw) as ChatTurn[];
    // A turn that was in flight when the page unloaded can't resume.
    return turns.map((t) =>
      t.status === 'searching' || t.status === 'streaming'
        ? { ...t, status: t.answer ? 'stopped' : 'error', error: t.answer ? undefined : 'Interrupted. Try again.' }
        : t,
    );
  } catch {
    return [];
  }
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function historyFor(turns: ChatTurn[]): ChatMessage[] {
  const done = turns.filter((t) => t.status === 'done' && t.answer).slice(-MAX_HISTORY_TURNS);
  return done.flatMap((t) => [
    { role: 'user' as const, content: t.question },
    { role: 'assistant' as const, content: t.answer.slice(0, MAX_HISTORY_CHARS) },
  ]);
}

/**
 * Conversation state for the chat view: streaming answers (with a fallback
 * to plain POST /query on older backends), follow-up history, stop/retry,
 * and persistence for the browser session.
 */
export function useChat() {
  const [turns, setTurns] = useState<ChatTurn[]>(loadTurns);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
    } catch {
      /* storage full / disabled: chat still works in memory */
    }
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((id: string, update: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) => {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...(typeof update === 'function' ? update(t) : update) } : t)),
    );
  }, []);

  const run = useCallback(
    async (id: string, question: string, prior: ChatTurn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const request = { question, top_k: 5, history: historyFor(prior) };

      try {
        if (streamingSupported) {
          try {
            await streamQuery(
              request,
              (event) => {
                if (event.type === 'sources') {
                  patch(id, { sources: event.sources, status: 'streaming' });
                } else if (event.type === 'delta') {
                  patch(id, (t) => ({ answer: t.answer + event.text, status: 'streaming' }));
                } else if (event.type === 'done') {
                  patch(id, {
                    answer: event.answer,
                    latency: event.latency,
                    model: event.model,
                    queryLogId: event.query_log_id,
                    status: 'done',
                  });
                }
              },
              controller.signal,
            );
            // Stream closed without a done event (proxy cut it off, etc.)
            patch(id, (t) =>
              t.status === 'done'
                ? {}
                : t.answer
                  ? { status: 'stopped' }
                  : { status: 'error', error: 'The answer stream ended unexpectedly. Try again.' },
            );
            return;
          } catch (e) {
            if (!(e instanceof StreamUnsupportedError)) throw e;
            streamingSupported = false;
          }
        }

        const data = await submitQuery(request, controller.signal);
        patch(id, {
          answer: data.answer,
          sources: data.sources,
          latency: data.latency,
          model: data.model ?? null,
          queryLogId: data.query_log_id,
          status: 'done',
        });
      } catch (e) {
        const aborted =
          controller.signal.aborted || (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'CanceledError';
        if (aborted) {
          patch(id, (t) => (t.status === 'done' ? {} : { status: t.answer ? 'stopped' : 'error', error: t.answer ? undefined : 'Stopped.' }));
        } else {
          patch(id, { status: 'error', error: getErrorMessage(e) });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [patch],
  );

  /** Ask a question as the next turn of the conversation. */
  const ask = useCallback(
    (question: string, opts: { fresh?: boolean } = {}) => {
      const q = question.trim();
      if (!q) return;
      const prior = opts.fresh ? [] : turnsRef.current;
      const turn: ChatTurn = { id: newId(), question: q, answer: '', sources: [], status: 'searching' };
      setTurns([...prior, turn]);
      void run(turn.id, q, prior);
    },
    [run],
  );

  /** Re-run a failed/stopped turn with the history that preceded it. */
  const retry = useCallback(
    (id: string) => {
      const idx = turnsRef.current.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const t = turnsRef.current[idx];
      patch(id, { answer: '', sources: [], status: 'searching', error: undefined, latency: undefined, model: undefined });
      void run(id, t.question, turnsRef.current.slice(0, idx));
    },
    [patch, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  const busy = turns.some((t) => t.status === 'searching' || t.status === 'streaming');

  return { turns, ask, retry, stop, reset, busy, setFeedback: (id: string, f: ChatTurn['feedback']) => patch(id, { feedback: f }) };
}
