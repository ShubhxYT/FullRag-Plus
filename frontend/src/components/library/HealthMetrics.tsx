import { useQuery } from '@tanstack/react-query';
import { fetchDocuments, fetchEvaluationSummary, getErrorMessage } from '../../lib/api';

function Stat({ label, value, suffix, children }: { label: string; value: string; suffix?: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <span className="text-sm font-medium text-outline uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-2">
        <span className="text-4xl font-extrabold text-on-surface">{value}</span>
        {suffix && <span className="text-on-surface-variant text-sm font-medium mb-1">{suffix}</span>}
      </div>
      {children}
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-slate-800 rounded-full h-1.5 mt-4">
      <div className={`${color} h-1.5 rounded-full transition-all duration-1000`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/**
 * Knowledge base size plus answer feedback. Feedback is the 👍/👎 on chat
 * answers, stored by POST /feedback and summed by GET /evaluation/summary.
 */
export default function HealthMetrics() {
  const evaluation = useQuery({
    queryKey: ['evaluation'],
    queryFn: () => fetchEvaluationSummary(),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const docs = useQuery({ queryKey: ['documents'], queryFn: fetchDocuments, retry: false });

  const counts = evaluation.data?.counts_by_type ?? {};
  const up = counts.thumbs_up ?? 0;
  const down = counts.thumbs_down ?? 0;
  const corrections = counts.correction ?? 0;
  const total = evaluation.data?.total_feedback ?? 0;
  const rated = up + down;
  const positive = rated ? (up / rated) * 100 : null;
  const avgRating = evaluation.data?.avg_rating ?? null;

  const docCount = docs.data?.total ?? docs.data?.documents.length;
  const chunkCount = docs.data?.documents.reduce((a, d) => a + d.chunk_count, 0);

  return (
    <section className="bg-slate-900/50 rounded-xl p-8 lg:p-12 relative overflow-hidden" data-testid="kb-health">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <div className="p-2 bg-tertiary-container text-on-tertiary-container rounded-lg">
            <span className="material-symbols-outlined">analytics</span>
          </div>
          <h2 className="text-xl font-bold font-headline">Knowledge Base Health</h2>
          {evaluation.isFetching && <span className="text-[10px] uppercase tracking-widest text-slate-500">Updating…</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <Stat label="Documents" value={docCount != null ? docCount.toLocaleString() : '—'}>
            <p className="text-xs text-slate-500 mt-4">Indexed and searchable</p>
          </Stat>
          <Stat label="Chunks" value={chunkCount != null ? chunkCount.toLocaleString() : '—'}>
            <p className="text-xs text-slate-500 mt-4">Passages answers can cite</p>
          </Stat>

          {evaluation.error ? (
            <div className="md:col-span-2 text-sm text-slate-400 bg-slate-800/40 rounded-xl p-4" role="status">
              <p className="font-bold text-slate-300 mb-1">Feedback stats unavailable</p>
              <p className="text-xs break-words mb-3">{getErrorMessage(evaluation.error)}</p>
              <button onClick={() => evaluation.refetch()} className="text-xs font-bold text-indigo-300 hover:text-indigo-200">
                Try again
              </button>
            </div>
          ) : evaluation.data && total === 0 ? (
            <div className="md:col-span-2 flex items-start gap-3 text-sm text-slate-400 bg-slate-800/40 rounded-xl p-4" data-testid="feedback-empty">
              <span className="material-symbols-outlined text-indigo-300">thumbs_up_down</span>
              <div>
                <p className="font-bold text-slate-300 mb-1">No feedback yet</p>
                <p className="text-xs">
                  Rate answers with the thumbs up / down buttons in your chats and the positive rate and feedback mix will show up here.
                </p>
              </div>
            </div>
          ) : (
            <>
              <Stat
                label="Positive rate"
                value={positive != null ? `${positive.toFixed(0)}%` : '—'}
                suffix={rated ? `of ${rated} rated` : undefined}
              >
                <Bar pct={positive ?? 0} color="bg-emerald-400" />
              </Stat>
              <Stat label="Feedback" value={evaluation.data ? total.toLocaleString() : '—'} suffix={avgRating != null ? `avg ${avgRating.toFixed(1)} / 5` : undefined}>
                <div className="flex gap-1 mt-4 h-1.5 rounded-full overflow-hidden bg-slate-800" aria-label="Feedback mix">
                  {total > 0 && (
                    <>
                      <div className="bg-emerald-400" style={{ width: `${(up / total) * 100}%` }} title={`${up} helpful`} />
                      <div className="bg-red-400" style={{ width: `${(down / total) * 100}%` }} title={`${down} not helpful`} />
                      <div className="bg-amber-300" style={{ width: `${(corrections / total) * 100}%` }} title={`${corrections} corrections`} />
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 flex flex-wrap gap-x-3">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />{up} helpful</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />{down} not helpful</span>
                  {corrections > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-amber-300 mr-1" />{corrections} corrections</span>}
                </p>
              </Stat>
            </>
          )}
        </div>
      </div>

      <div className="absolute top-0 right-0 w-96 h-96 opacity-20 pointer-events-none transform translate-x-1/4 -translate-y-1/4 bg-gradient-to-br from-indigo-500/30 to-transparent blur-3xl" />
    </section>
  );
}
