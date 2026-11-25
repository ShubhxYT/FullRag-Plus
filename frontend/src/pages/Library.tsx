import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { deleteDocuments, fetchDocuments, getErrorMessage } from '../lib/api';
import type { DocumentItem, DocumentsResponse } from '../lib/types';
import DocumentCard, { displayTitle, isDocProcessing } from '../components/library/DocumentCard';
import ConfirmDeleteDialog from '../components/library/ConfirmDeleteDialog';
import HealthMetrics from '../components/library/HealthMetrics';
import UploadModal from '../components/library/UploadModal';

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.3 } },
};

export default function Library() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    retry: false,
  });
  const [showUpload, setShowUpload] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<DocumentItem[] | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const docs = data?.documents ?? [];
  const deletable = docs.filter((d) => !isDocProcessing(d));

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Drop selections for documents that are gone.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(docs.map((d) => d.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUploadSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['documents'] });
  };

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const confirmDelete = async () => {
    if (!pending) return;
    const ids = pending.map((d) => d.id);
    setDeleting(new Set(ids));
    try {
      const res = await deleteDocuments(ids);
      const gone = new Set([...res.deleted, ...res.not_found]);
      queryClient.setQueryData<DocumentsResponse>(['documents'], (old) =>
        old ? { documents: old.documents.filter((d) => !gone.has(d.id)), total: old.total - gone.size } : old,
      );
      const n = res.deleted.length;
      setToast({
        kind: 'ok',
        text:
          n === 1 && pending.length === 1
            ? `Deleted “${displayTitle(pending[0].title, pending[0].source_path)}”.`
            : `Deleted ${n} document${n === 1 ? '' : 's'}${res.not_found.length ? ` (${res.not_found.length} already gone)` : ''}.`,
      });
      setPending(null);
      exitSelecting();
    } catch (e) {
      setToast({ kind: 'error', text: `Couldn't delete: ${getErrorMessage(e)}` });
      setPending(null);
    } finally {
      setDeleting(new Set());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="flex-1 p-6 lg:p-10"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl font-extrabold font-headline text-on-surface tracking-tight mb-2">
              Knowledge Base
            </h1>
            <p className="text-on-surface-variant font-medium">
              Manage and monitor your indexed intellectual assets.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          {deletable.length > 0 && (
            <button
              onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
              className="flex items-center justify-center gap-2 px-6 py-4 rounded-full font-headline font-bold text-sm tracking-widest bg-slate-800/70 hover:bg-slate-700/70 text-slate-200 border border-white/5"
            >
              <span className="material-symbols-outlined">{selecting ? 'close' : 'checklist'}</span>
              {selecting ? 'CANCEL' : 'SELECT'}
            </button>
          )}
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center justify-center gap-2 px-8 py-4 primary-gradient text-white rounded-full font-headline font-bold text-sm tracking-widest shadow-xl hover:scale-[0.98] transition-transform w-full md:w-auto"
          >
            <span className="material-symbols-outlined">upload_file</span>
            UPLOAD DOCUMENTS
          </button>
          </div>
        </header>

        {selecting && (
          <div className="sticky top-16 md:top-4 z-30 mb-6 flex flex-wrap items-center gap-3 bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 shadow-xl" data-testid="selection-bar">
            <span className="text-sm text-slate-300 font-medium flex-1 min-w-[8rem]">
              {selected.size ? `${selected.size} selected` : 'Tap documents to select them'}
            </span>
            <button
              onClick={() =>
                setSelected(selected.size === deletable.length ? new Set() : new Set(deletable.map((d) => d.id)))
              }
              className="px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              {selected.size === deletable.length ? 'Clear' : 'Select all'}
            </button>
            <button
              onClick={() => setPending(docs.filter((d) => selected.has(d.id)))}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              Delete{selected.size ? ` (${selected.size})` : ''}
            </button>
          </div>
        )}

        <ConfirmDeleteDialog
          names={pending ? pending.map((d) => displayTitle(d.title, d.source_path)) : null}
          busy={deleting.size > 0}
          onCancel={() => setPending(null)}
          onConfirm={confirmDelete}
        />

        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 w-full max-w-md pointer-events-none" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                role={toast.kind === 'error' ? 'alert' : 'status'}
                data-testid="toast"
                className={`pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-2xl border ${
                  toast.kind === 'error'
                    ? 'bg-red-950/90 border-red-500/30 text-red-200'
                    : 'bg-slate-800/95 border-white/10 text-slate-100'
                }`}
              >
                <span className="material-symbols-outlined text-base">{toast.kind === 'error' ? 'error' : 'check_circle'}</span>
                <span className="flex-1 break-words">{toast.text}</span>
                <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-slate-400 hover:text-white">
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <UploadModal
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />

        {/* Document Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-800/50 p-6 rounded-xl animate-pulse"
                >
                  <div className="h-10 w-10 bg-slate-700 rounded-lg mb-4" />
                  <div className="h-5 bg-slate-700 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-slate-700 rounded w-1/2 mb-6" />
                  <div className="h-3 bg-slate-700 rounded w-full" />
                </div>
              ))
            : docs.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  selecting={selecting}
                  selected={selected.has(doc.id)}
                  deleting={deleting.has(doc.id)}
                  onToggleSelect={toggle}
                  onDelete={(d) => setPending([d])}
                />
              ))}
          {!isLoading && error && (
            <div
              role="alert"
              className="col-span-full bg-red-950/30 border border-red-500/20 rounded-2xl p-6 text-red-300"
            >
              <p className="font-headline font-bold mb-1">Couldn&apos;t load documents</p>
              <p className="text-sm text-red-400 mb-4 break-words">{getErrorMessage(error)}</p>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest bg-red-900/40 hover:bg-red-900/60 text-red-200 disabled:opacity-50"
              >
                {isFetching ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          )}
          {!isLoading && data && data.documents.length === 0 && (
            <div className="col-span-full text-center py-16 text-slate-500">
              <span className="material-symbols-outlined text-4xl mb-4 block">
                folder_off
              </span>
              <p className="font-headline font-bold text-lg mb-2">
                No documents yet
              </p>
              <p className="text-sm">
                Upload your first document to get started.
              </p>
            </div>
          )}
        </div>

        {/* Knowledge Base Health */}
        <HealthMetrics />

        <footer className="mt-16 text-center text-outline text-xs font-medium tracking-widest uppercase">
          © {new Date().getFullYear()} FullRag Systems • Intellectual Integrity Secured
        </footer>
      </div>
    </motion.div>
  );
}
