import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  names: string[] | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Asks before deleting; names the documents so nothing goes by mistake. */
export default function ConfirmDeleteDialog({ names, busy, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const open = names !== null && names.length > 0;

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  const shown = names?.slice(0, 6) ?? [];
  const more = (names?.length ?? 0) - shown.length;
  const count = names?.length ?? 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !busy && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.15 }}
            className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 shrink-0 rounded-full bg-red-900/40 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-300">delete</span>
              </div>
              <div className="min-w-0">
                <h3 id="confirm-delete-title" className="font-headline font-bold text-lg text-white">
                  Delete {count === 1 ? 'this document' : `${count} documents`}?
                </h3>
                <p className="text-sm text-slate-400">
                  {count === 1 ? 'It' : 'They'} will be removed from the knowledge base with all {count === 1 ? 'its' : 'their'} chunks
                  and embeddings, and won&apos;t be used in answers any more. This can&apos;t be undone.
                </p>
              </div>
            </div>
            <ul className="mb-6 space-y-1 max-h-48 overflow-y-auto" data-testid="confirm-names">
              {shown.map((n, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-slate-200 bg-slate-800/60 rounded-lg px-3 py-2">
                  <span className="material-symbols-outlined text-base text-slate-400">description</span>
                  <span className="truncate" title={n}>{n}</span>
                </li>
              ))}
              {more > 0 && <li className="text-xs text-slate-500 px-3">…and {more} more</li>}
            </ul>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                ref={cancelRef}
                onClick={onCancel}
                disabled={busy}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={busy}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-60"
              >
                {busy ? 'Deleting…' : count === 1 ? 'Delete document' : `Delete ${count} documents`}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
