import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from './api';

export type HealthState = 'loading' | 'ok' | 'degraded' | 'down';

/** Shared backend health query (polled), used by the sidebar and home page. */
export function useHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: false,
    refetchInterval: 30_000,
  });

  let state: HealthState = 'loading';
  if (query.isError) state = 'down';
  else if (query.data) {
    state =
      query.data.status === 'ok' && query.data.database === 'connected'
        ? 'ok'
        : 'degraded';
  }

  const label = {
    loading: 'Connecting…',
    ok: 'System Healthy',
    degraded: 'Degraded',
    down: 'Backend Unreachable',
  }[state];

  return { ...query, state, label };
}

export const healthDotClass: Record<HealthState, string> = {
  loading: 'bg-slate-500',
  ok: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
  degraded: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
  down: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
};
