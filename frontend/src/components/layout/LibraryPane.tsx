import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteDocuments, fetchDocuments, getErrorMessage } from '../../lib/api';
import type { DocumentItem, DocumentsResponse } from '../../lib/types';
import { displayTitle, isDocProcessing } from '../library/DocumentCard';
import ConfirmDeleteDialog from '../library/ConfirmDeleteDialog';
import UploadModal from '../library/UploadModal';
import { IconFile, IconInfo, IconTrash } from '../icons';
import { fileNameOf } from './SourcesPane';

export default function LibraryPane() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    retry: false,
  });
  const [showUpload, setShowUpload] = useState(false);
  const [pending, setPending] = useState<DocumentItem[] | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const docs = data?.documents ?? [];
  const chunks = docs.reduce((n, d) => n + (d.chunk_count || 0), 0);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const confirmDelete = useCallback(async () => {
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
    } catch (e) {
      setToast({ kind: 'error', text: `Couldn't delete: ${getErrorMessage(e)}` });
      setPending(null);
    } finally {
      setDeleting(new Set());
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  }, [pending, queryClient]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        type="button"
        onClick={() => setShowUpload(true)}
        className="mx-3 mt-3 p-4 text-center rounded-[10px] border border-dashed"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text-muted)' }}
      >
        <strong className="block text-[13px] text-[color:var(--text)]">Upload documents</strong>
        <span className="block text-xs mt-0.5">PDF, Markdown or text · 50 MB · up to 20 files</span>
      </button>

      <div
        className="mx-3 mt-2 mb-1 p-2.5 rounded-md flex gap-2 items-start text-xs leading-snug"
        style={{ background: 'var(--warn-soft)', color: 'var(--text-muted)' }}
        role="note"
        data-testid="cpu-notice"
      >
        <IconInfo className="icon shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
        <span>
          Document parsing runs on the server CPU, not a GPU, so large uploads can take a few minutes. You can leave this
          open while it works.
        </span>
      </div>

      <div className="px-3 py-2 text-xs flex items-center justify-between" style={{ color: 'var(--text-muted)' }}>
        <span>
          {isLoading ? 'Loading…' : `${data?.total ?? 0} indexed · ${chunks.toLocaleString()} chunks`}
        </span>
        <button type="button" className="font-semibold" style={{ color: 'var(--accent)' }} onClick={() => refetch()} disabled={isFetching}>
          Refresh
        </button>
      </div>

      {error && (
        <p className="px-3 text-xs" style={{ color: 'var(--danger)' }}>
          Couldn’t load the library. {getErrorMessage(error)}
        </p>
      )}

      <div className="scroll-thin flex-1 pb-3">
        {docs.map((doc) => {
          const name = fileNameOf(doc.source_path);
          const processing = isDocProcessing(doc);
          return (
            <div key={doc.id} className="lib-row flex items-start gap-2.5 mx-1.5 px-2 py-2 rounded-md group">
              <div
                className="w-7 h-7 rounded-md grid place-items-center shrink-0 mt-0.5"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <IconFile />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium leading-snug break-words">{name}</div>
                <div className="text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
                  {processing ? 'Processing…' : `${doc.chunk_count} chunks`}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100 max-[760px]:opacity-100"
                style={{ color: 'var(--text-faint)' }}
                aria-label={`Delete ${name}`}
                disabled={deleting.has(doc.id) || processing}
                onClick={() => setPending([doc])}
              >
                <IconTrash />
              </button>
            </div>
          );
        })}
        {!isLoading && docs.length === 0 && (
          <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-faint)' }}>
            No documents yet. Upload a file to start asking questions.
          </p>
        )}
      </div>

      {toast && (
        <div
          className="mx-3 mb-3 px-3 py-2 rounded-md text-xs"
          style={{
            background: toast.kind === 'error' ? 'var(--danger-soft)' : 'var(--bg-elev)',
            color: toast.kind === 'error' ? 'var(--danger)' : 'var(--text)',
            border: '1px solid var(--border)',
          }}
          role="status"
        >
          {toast.text}
        </div>
      )}

      <UploadModal open={showUpload} onClose={() => setShowUpload(false)} onSuccess={() => queryClient.invalidateQueries({ queryKey: ['documents'] })} />
      <ConfirmDeleteDialog
        names={pending ? pending.map((d) => displayTitle(d.title, d.source_path)) : null}
        busy={deleting.size > 0}
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
