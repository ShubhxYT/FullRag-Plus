/**
 * Per-browser conversation store (localStorage) plus the chat "engine".
 *
 * - Conversations survive navigation, reloads and browser restarts; there
 *   are no server-side accounts, so history belongs to this browser only.
 * - Answers stream into the store at module level, so leaving the chat
 *   (e.g. to the Library) doesn't abort or lose an in-flight answer.
 * - Components subscribe with useSyncExternalStore (see useChatStore).
 */
import {
  StreamUnsupportedError,
  getErrorMessage,
  streamQuery,
  submitQuery,
} from './api';
import type { ChatMessage, Coverage, LatencyBreakdown, Source } from './types';
import { getSelectedSources } from './sourceSelection';

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
  createdAt?: number;
  /** Live progress from the server ("Read 5 of 23 documents…"). */
  progress?: string;
  /** Documents the question was limited to (source picker); absent = all. */
  documentIds?: string[];
  coverage?: Coverage | null;
}

export interface Conversation {
  id: string;
  title: string;
  /** true once the user renamed it (stop auto-titling) */
  customTitle?: boolean;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
  /** last scroll offset of the chat view, restored when coming back */
  scrollY?: number;
}

interface State {
  version: 1;
  activeId: string | null;
  conversations: Conversation[]; // newest first by updatedAt
}

const STORAGE_KEY = 'fullrag.conversations.v1';
const LEGACY_SESSION_KEY = 'fullrag.chat.v1';
const MAX_CONVERSATIONS = 100;
const MAX_HISTORY_TURNS = 3; // Q/A pairs sent to the backend as context
const MAX_HISTORY_CHARS = 2000;
const TITLE_MAX = 80;

export function newId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFrom(question: string) {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t || 'New chat';
}

function settleInterrupted(turn: ChatTurn): ChatTurn {
  // A turn that was streaming when the page closed can't resume.
  if (turn.status === 'searching' || turn.status === 'streaming') {
    return turn.answer
      ? { ...turn, status: 'stopped' }
      : { ...turn, status: 'error', error: 'Interrupted before an answer arrived. Try again.' };
  }
  return turn;
}

function load(): State {
  const empty: State = { version: 1, activeId: null, conversations: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed?.version === 1 && Array.isArray(parsed.conversations)) {
        parsed.conversations = parsed.conversations.map((c) => ({ ...c, turns: c.turns.map(settleInterrupted) }));
        return parsed;
      }
    }
    // One-time migration of the earlier session-only chat.
    const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
    if (legacy) {
      const turns = (JSON.parse(legacy) as ChatTurn[]).map(settleInterrupted);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      if (turns.length) {
        const now = Date.now();
        const conv: Conversation = { id: newId('c-'), title: titleFrom(turns[0].question), createdAt: now, updatedAt: now, turns };
        return { version: 1, activeId: conv.id, conversations: [conv] };
      }
    }
  } catch {
    /* corrupted or unavailable storage: start empty */
  }
  return empty;
}

let state: State = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded: drop the oldest conversations (never the active one) and retry once.
    const keep = state.conversations.filter((c) => c.id === state.activeId).concat(
      state.conversations.filter((c) => c.id !== state.activeId).slice(0, Math.floor(state.conversations.length / 2)),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, conversations: keep }));
    } catch {
      /* give up silently; the in-memory chat still works */
    }
  }
}

/** Streaming produces many updates; write to storage at most every 400 ms. */
function persistSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(persistNow, 400);
}

function setState(next: State, immediate = false) {
  state = next;
  if (immediate) persistNow();
  else persistSoon();
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', persistNow);
  window.addEventListener('pagehide', persistNow);
  // Keep tabs in sync (another tab saved conversations).
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const incoming = JSON.parse(e.newValue) as State;
      // Don't clobber conversations this tab is streaming into right now.
      const streamingIds = new Set(controllers.keys());
      const mine = state.conversations.filter((c) => streamingIds.has(c.id));
      const merged = incoming.conversations.filter((c) => !streamingIds.has(c.id)).concat(mine);
      state = { ...incoming, activeId: state.activeId, conversations: sortConvs(merged) };
      listeners.forEach((l) => l());
    } catch {
      /* ignore */
    }
  });
}

function sortConvs(list: Conversation[]) {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

export function getConversation(id: string | null | undefined) {
  return id ? state.conversations.find((c) => c.id === id) : undefined;
}

function updateConversation(id: string, fn: (c: Conversation) => Conversation, immediate = false) {
  setState(
    { ...state, conversations: state.conversations.map((c) => (c.id === id ? fn(c) : c)) },
    immediate,
  );
}

function patchTurn(convId: string, turnId: string, patch: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>), immediate = false) {
  updateConversation(
    convId,
    (c) => ({
      ...c,
      turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)),
    }),
    immediate,
  );
}

// ---------------------------------------------------------------- actions

export function setActive(id: string | null) {
  if (state.activeId === id) return;
  setState({ ...state, activeId: id }, true);
}

/** Start a fresh conversation (optionally with a first question). */
export function newConversation(firstQuestion?: string): string {
  const now = Date.now();
  const conv: Conversation = {
    id: newId('c-'),
    title: firstQuestion ? titleFrom(firstQuestion) : 'New chat',
    createdAt: now,
    updatedAt: now,
    turns: [],
  };
  // Drop empty conversations nobody asked anything in.
  const rest = state.conversations.filter((c) => c.turns.length > 0);
  setState({ ...state, activeId: conv.id, conversations: sortConvs([conv, ...rest]) }, true);
  if (firstQuestion) ask(conv.id, firstQuestion);
  return conv.id;
}

/** Leave the current chat; the next question starts a new conversation. */
export function clearActive() {
  setState(
    { ...state, activeId: null, conversations: state.conversations.filter((c) => c.turns.length > 0) },
    true,
  );
}

export function renameConversation(id: string, title: string) {
  const t = title.trim();
  if (!t) return;
  updateConversation(id, (c) => ({ ...c, title: t.slice(0, TITLE_MAX), customTitle: true }), true);
}

export function deleteConversation(id: string) {
  controllers.get(id)?.abort();
  setState(
    {
      ...state,
      activeId: state.activeId === id ? null : state.activeId,
      conversations: state.conversations.filter((c) => c.id !== id),
    },
    true,
  );
}

export function saveScroll(id: string, scrollY: number) {
  const c = getConversation(id);
  if (!c || Math.abs((c.scrollY ?? 0) - scrollY) < 2) return;
  // no re-render needed for listeners; just remember it
  c.scrollY = scrollY;
  persistSoon();
}

export function setFeedback(convId: string, turnId: string, feedback: ChatTurn['feedback']) {
  patchTurn(convId, turnId, { feedback }, true);
}

// ----------------------------------------------------------------- engine

const controllers = new Map<string, AbortController>(); // per conversation
let streamingSupported = true;

export function isBusy(convId: string) {
  return controllers.has(convId);
}

function historyFor(turns: ChatTurn[]): ChatMessage[] {
  return turns
    .filter((t) => t.status === 'done' && t.answer)
    .slice(-MAX_HISTORY_TURNS)
    .flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.answer.slice(0, MAX_HISTORY_CHARS) },
    ]);
}

async function run(convId: string, turnId: string, question: string, prior: ChatTurn[]) {
  controllers.get(convId)?.abort();
  const controller = new AbortController();
  controllers.set(convId, controller);
  listeners.forEach((l) => l());
  const picked = getSelectedSources();
  const request = {
    question,
    top_k: 5,
    history: historyFor(prior),
    ...(picked.length ? { document_ids: picked } : {}),
  };
  patchTurn(convId, turnId, { documentIds: picked.length ? picked : undefined });

  try {
    if (streamingSupported) {
      try {
        await streamQuery(
          request,
          (event) => {
            if (event.type === 'status') patchTurn(convId, turnId, { progress: event.text });
            else if (event.type === 'sources')
              patchTurn(convId, turnId, { sources: event.sources, coverage: event.coverage ?? null, status: 'streaming', progress: undefined });
            else if (event.type === 'delta')
              patchTurn(convId, turnId, (t) => ({ answer: t.answer + event.text, status: 'streaming' }));
            else if (event.type === 'done')
              patchTurn(
                convId,
                turnId,
                {
                  answer: event.answer,
                  latency: event.latency,
                  model: event.model,
                  queryLogId: event.query_log_id,
                  coverage: event.coverage ?? null,
                  status: 'done',
                },
                true,
              );
          },
          controller.signal,
        );
        patchTurn(
          convId,
          turnId,
          (t) =>
            t.status === 'done'
              ? {}
              : t.answer
                ? { status: 'stopped' }
                : { status: 'error', error: 'The answer stream ended unexpectedly. Try again.' },
          true,
        );
        return;
      } catch (e) {
        if (!(e instanceof StreamUnsupportedError)) throw e;
        streamingSupported = false;
      }
    }
    const data = await submitQuery(request, controller.signal);
    patchTurn(
      convId,
      turnId,
      {
        answer: data.answer,
        sources: data.sources,
        latency: data.latency,
        model: data.model ?? null,
        queryLogId: data.query_log_id,
        coverage: data.coverage ?? null,
        status: 'done',
      },
      true,
    );
  } catch (e) {
    const aborted =
      controller.signal.aborted || (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'CanceledError';
    patchTurn(
      convId,
      turnId,
      (t) =>
        aborted
          ? t.status === 'done'
            ? {}
            : { status: t.answer ? 'stopped' : 'error', error: t.answer ? undefined : 'Stopped.' }
          : { status: 'error', error: getErrorMessage(e) },
      true,
    );
  } finally {
    if (controllers.get(convId) === controller) controllers.delete(convId);
    listeners.forEach((l) => l());
  }
}

/** Ask the next question in a conversation. */
export function ask(convId: string, question: string) {
  const q = question.trim();
  const conv = getConversation(convId);
  if (!q || !conv) return;
  const prior = conv.turns;
  const turn: ChatTurn = { id: newId('t-'), question: q, answer: '', sources: [], status: 'searching', createdAt: Date.now() };
  updateConversation(
    convId,
    (c) => ({
      ...c,
      title: c.customTitle || c.turns.length ? c.title : titleFrom(q),
      updatedAt: Date.now(),
      turns: [...c.turns, turn],
    }),
    true,
  );
  setState({ ...state, activeId: convId, conversations: sortConvs(state.conversations) }, true);
  void run(convId, turn.id, q, prior);
}

/** Re-run a turn with the history that preceded it. */
export function retry(convId: string, turnId: string) {
  const conv = getConversation(convId);
  const idx = conv?.turns.findIndex((t) => t.id === turnId) ?? -1;
  if (!conv || idx < 0) return;
  const t = conv.turns[idx];
  patchTurn(convId, turnId, {
    answer: '',
    sources: [],
    status: 'searching',
    error: undefined,
    latency: undefined,
    model: undefined,
    feedback: undefined,
  });
  void run(convId, turnId, t.question, conv.turns.slice(0, idx));
}

export function stop(convId: string) {
  controllers.get(convId)?.abort();
}

/** Test/debug helper (exposed for headless tests via window in dev). */
export function _resetForTests() {
  controllers.forEach((c) => c.abort());
  controllers.clear();
  state = { version: 1, activeId: null, conversations: [] };
  persistNow();
  listeners.forEach((l) => l());
}
