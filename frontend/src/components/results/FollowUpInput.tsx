import { useState, type FormEvent } from 'react';

interface Props {
  onSubmit: (query: string) => void;
  /** The question currently shown, so suggestion chips can refer to it. */
  currentQuestion?: string;
}

// Chips used to send the bare label ("Explain in detail") as the question,
// which the RAG pipeline can't answer. They now build on the current question.
const followUpSuggestions: { label: string; build: (q: string) => string }[] = [
  { label: 'Explain in detail', build: (q) => `Explain in detail: ${q}` },
  { label: 'Show related topics', build: (q) => `What topics are related to: ${q}` },
  { label: 'Compare approaches', build: (q) => `Compare the different approaches to: ${q}` },
];

export default function FollowUpInput({ onSubmit, currentQuestion }: Props) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSubmit(query.trim());
      setQuery('');
    }
  };

  return (
    <footer className="sticky bottom-20 md:bottom-0 z-30 w-full px-4 md:px-8 pb-4 md:pb-10 pt-4 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent">
      <div className="max-w-4xl mx-auto relative group">
        <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-indigo-800 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-1000" />
        <form
          onSubmit={handleSubmit}
          className="relative bg-slate-900/80 backdrop-blur-xl rounded-2xl flex items-center px-4 md:px-6 py-3 md:py-5 shadow-2xl border border-white/10"
        >
          <span className="material-symbols-outlined text-indigo-400 mr-3 md:mr-4 text-2xl">
            psychology
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Ask a follow-up question"
            className="flex-grow min-w-0 bg-transparent border-none text-white focus:ring-0 placeholder-slate-500 font-body text-base"
            placeholder="Ask a follow-up question..."
            type="text"
          />
          <div className="flex items-center gap-4 ml-2">
            <button
              type="submit"
              aria-label="Send follow-up"
              className="h-11 w-11 primary-gradient rounded-xl flex items-center justify-center text-white shadow-xl shadow-indigo-900/40 hover:scale-105 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined">arrow_upward</span>
            </button>
          </div>
        </form>

        {currentQuestion && (
        <div className="mt-3 md:mt-6 flex flex-wrap justify-center gap-2 md:gap-4">
          {followUpSuggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => onSubmit(s.build(currentQuestion))}
              className="text-[10px] font-bold text-slate-400 hover:text-indigo-300 transition-all uppercase tracking-widest px-4 py-2 bg-slate-900/60 border border-white/5 hover:border-indigo-500/30 rounded-full backdrop-blur-sm"
            >
              {s.label}
            </button>
          ))}
        </div>
        )}
      </div>
    </footer>
  );
}
