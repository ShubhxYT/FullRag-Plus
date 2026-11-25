import { useSyncExternalStore } from 'react';
import { getState, subscribe, isBusy } from './chatStore';

/** Subscribe to the whole conversation store. */
export function useChatState() {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Subscribe to one conversation (undefined if it doesn't exist). */
export function useConversation(id: string | null | undefined) {
  const state = useChatState();
  const conv = id ? state.conversations.find((c) => c.id === id) : undefined;
  const busy = useSyncExternalStore(subscribe, () => (id ? isBusy(id) : false), () => false);
  return { conversation: conv, busy };
}
