import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { uploadDocument, getUploadStatus, getErrorMessage } from '../../lib/api';
import type { UploadStage } from '../../lib/types';

const ACCEPTED_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
};
const ACCEPTED_EXTS = Object.keys(ACCEPTED_MIME).join(', ');
// Extensions as well as MIME types: browsers often report .md as text/plain or "".
const ACCEPTED_ACCEPT = [...Object.keys(ACCEPTED_MIME), ...Object.values(ACCEPTED_MIME)].join(',');
const MAX_SIZE_MB = 50;
const MAX_FILES = 20;
/** Ingestion is CPU-heavy on the server, so files go one at a time. */
const CONCURRENCY = 1;

const STAGE_LABELS: Record<UploadStage, string> = {
  queued: 'Waiting on server…',
  loading: 'Parsing…',
  saving: 'Saving…',
  embedding: 'Embedding…',
  indexing: 'Indexing…',
  summarizing: 'Summarizing…',
  complete: 'Indexed',
  error: 'Failed',
};

type ItemStatus = 'ready' | 'invalid' | 'uploading' | 'processing' | 'complete' | 'error' | 'cancelled';

interface Item {
  id: string;
  file: File;
  status: ItemStatus;
  progress: number;
  stage?: UploadStage;
  message?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (!ACCEPTED_MIME[ext]) return `Unsupported type "${ext}". Accepted: ${ACCEPTED_EXTS}`;
  if (file.size === 0) return 'File is empty.';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Larger than ${MAX_SIZE_MB} MB.`;
  return null;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

export default function UploadModal({ open, onClose, onSuccess }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  const cancelRef = useRef(false);
  const aliveRef = useRef(true);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const commit = (next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const patch = (id: string, p: Partial<Item>) => {
    if (!aliveRef.current) return;
    commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...p } : it)));
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const busy = items.some((i) => i.status === 'uploading' || i.status === 'processing');
  const readyCount = items.filter((i) => i.status === 'ready').length;
  const doneCount = items.filter((i) => i.status === 'complete').length;
  const failedCount = items.filter((i) => i.status === 'error').length;
  const finished = items.length > 0 && !busy && !running && readyCount === 0;

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list);
    const current = itemsRef.current;
    const room = MAX_FILES - current.length;
    const fresh: Item[] = [];
    let dupes = 0;
    for (const file of files) {
      const dupe =
        current.some((i) => i.file.name === file.name && i.file.size === file.size) ||
        fresh.some((i) => i.file.name === file.name && i.file.size === file.size);
      if (dupe) {
        dupes++;
        continue;
      }
      if (fresh.length >= room) break;
      const err = validateFile(file);
      fresh.push({
        id: `f${++seq}`,
        file,
        status: err ? 'invalid' : 'ready',
        progress: 0,
        message: err ?? undefined,
      });
    }
    const skipped = files.length - fresh.length - dupes;
    const parts: string[] = [];
    if (dupes) parts.push(`${dupes} duplicate${dupes > 1 ? 's' : ''} skipped`);
    if (skipped > 0) parts.push(`only ${MAX_FILES} files per batch`);
    setNotice(parts.length ? parts.join(' · ') : null);
    commit([...current, ...fresh]);
  };

  const uploadOne = async (item: Item) => {
    patch(item.id, { status: 'uploading', progress: 0, message: undefined });
    try {
      const { job_id } = await uploadDocument(item.file, (pct) =>
        patch(item.id, { progress: Math.min(pct, 99) }),
      );
      patch(item.id, { status: 'processing', stage: 'queued', progress: 0 });
      let failures = 0;
      while (aliveRef.current) {
        await sleep(700);
        try {
          const s = await getUploadStatus(job_id);
          failures = 0;
          if (s.stage === 'complete') {
            patch(item.id, { status: 'complete', stage: 'complete', progress: 100 });
            onSuccessRef.current();
            return;
          }
          if (s.stage === 'error') {
            patch(item.id, { status: 'error', message: s.error ?? 'Processing failed' });
            return;
          }
          patch(item.id, { stage: s.stage, progress: s.progress });
        } catch (e) {
          if (++failures >= 5) {
            patch(item.id, { status: 'error', message: `Lost track of the upload: ${getErrorMessage(e)}` });
            return;
          }
        }
      }
    } catch (e) {
      patch(item.id, { status: 'error', message: getErrorMessage(e) });
    }
  };

  // Simple worker pool over the "ready" items; files added while running
  // join the queue.
  const runQueue = async () => {
    cancelRef.current = false;
    setRunning(true);
    const worker = async () => {
      while (aliveRef.current && !cancelRef.current) {
        const next = itemsRef.current.find((i) => i.status === 'ready');
        if (!next) return;
        await uploadOne(next);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (aliveRef.current) setRunning(false);
  };

  const cancelRemaining = () => {
    cancelRef.current = true;
    commit(itemsRef.current.map((i) => (i.status === 'ready' ? { ...i, status: 'cancelled' } : i)));
  };

  const retryFailed = () => {
    commit(
      itemsRef.current.map((i) =>
        i.status === 'error' || i.status === 'cancelled' ? { ...i, status: 'ready', progress: 0, message: undefined } : i,
      ),
    );
    void runQueue();
  };

  const remove = (id: string) => commit(itemsRef.current.filter((i) => i.id !== id));

  const reset = () => {
    commit([]);
    setNotice(null);
  };

  const handleClose = () => {
    if (busy || running) return; // keep the page (and its pollers) alive until the batch finishes
    reset();
    onClose();
  };

  const statusText = (it: Item) => {
    switch (it.status) {
      case 'ready':
        return running ? 'Queued' : 'Ready';
      case 'invalid':
        return it.message;
      case 'uploading':
        return `Uploading ${it.progress}%`;
      case 'processing':
        return STAGE_LABELS[it.stage ?? 'queued'];
      case 'complete':
        return 'Indexed';
      case 'error':
        return it.message;
      case 'cancelled':
        return 'Cancelled';
    }
  };

  const barPct = (it: Item) =>
    it.status === 'uploading'
      ? Math.round(it.progress * 0.3)
      : it.status === 'processing'
      ? 30 + Math.round(it.progress * 0.7)
      : it.status === 'complete'
      ? 100
      : 0;

  const icon: Record<ItemStatus, [string, string]> = {
    ready: ['description', 'text-slate-400'],
    invalid: ['block', 'text-amber-400'],
    uploading: ['cloud_upload', 'text-indigo-400 animate-pulse'],
    processing: ['memory', 'text-indigo-400 animate-pulse'],
    complete: ['check_circle', 'text-emerald-400'],
    error: ['error', 'text-red-400'],
    cancelled: ['do_not_disturb_on', 'text-slate-500'],
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label="Upload documents"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2 }}
            className="bg-slate-900 border border-white/10 rounded-2xl p-5 md:p-8 w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-headline font-bold text-xl text-white">Upload Documents</h3>
              {!busy && !running && (
                <button onClick={handleClose} className="text-slate-500 hover:text-white transition-colors" aria-label="Close">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors select-none
                ${items.length ? 'p-4' : 'p-10'}
                ${dragging ? 'border-indigo-400 bg-indigo-950/30' : 'border-slate-700 hover:border-indigo-500 hover:bg-slate-800/40'}`}
            >
              <span className={`material-symbols-outlined text-indigo-400 ${items.length ? 'text-2xl' : 'text-4xl'}`}>upload_file</span>
              <p className="font-headline font-bold text-white text-sm">
                {items.length ? 'Add more files' : 'Drag & drop files or '}
                {!items.length && <span className="text-indigo-400">browse</span>}
              </p>
              <p className="text-xs text-slate-500 text-center">
                Select several at once · {ACCEPTED_EXTS} · max {MAX_SIZE_MB} MB each
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_ACCEPT}
              className="hidden"
              data-testid="upload-input"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {notice && <p className="mt-2 text-xs text-amber-300 text-center">{notice}</p>}

            {items.length > 0 && (
              <ul className="mt-4 space-y-2 overflow-y-auto pr-1 min-h-0" aria-label="Files">
                {items.map((it) => {
                  const [ic, icClass] = icon[it.status];
                  const pct = barPct(it);
                  return (
                    <li key={it.id} className="bg-slate-800/70 rounded-xl px-3 py-2.5" data-testid="upload-item" data-status={it.status}>
                      <div className="flex items-center gap-3">
                        <span className={`material-symbols-outlined text-xl ${icClass}`}>{ic}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate" title={it.file.name}>
                            {it.file.name}
                          </p>
                          <p
                            className={`text-[11px] truncate ${
                              it.status === 'error' ? 'text-red-300' : it.status === 'invalid' ? 'text-amber-300' : 'text-slate-400'
                            }`}
                            title={statusText(it) ?? ''}
                          >
                            {formatSize(it.file.size)} · {statusText(it)}
                          </p>
                        </div>
                        {(it.status === 'ready' || it.status === 'invalid' || it.status === 'cancelled') && (
                          <button
                            onClick={() => remove(it.id)}
                            className="text-slate-500 hover:text-white p-1"
                            aria-label={`Remove ${it.file.name}`}
                          >
                            <span className="material-symbols-outlined text-base">close</span>
                          </button>
                        )}
                      </div>
                      {(it.status === 'uploading' || it.status === 'processing') && (
                        <div className="mt-2 w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                          <motion.div
                            className="h-full primary-gradient rounded-full"
                            initial={{ width: '0%' }}
                            animate={{ width: `${pct}%` }}
                            transition={{ ease: 'easeOut', duration: 0.4 }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {(busy || running) && (
              <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-400 bg-slate-800/40 rounded-lg px-3 py-2" role="note" data-testid="cpu-notice">
                <span className="material-symbols-outlined text-sm text-indigo-300">hourglass_top</span>
                <span>Hang tight, this can take a little while: document parsing runs on a CPU, not a GPU. You can keep this open while it works.</span>
              </p>
            )}

            {items.length > 0 && (
              <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:items-center">
                <p className="text-xs text-slate-400 flex-1" aria-live="polite">
                  {doneCount}/{items.filter((i) => i.status !== 'invalid').length} indexed
                  {failedCount ? ` · ${failedCount} failed` : ''}
                  {running ? ' · one file at a time' : ''}
                </p>
                {running ? (
                  readyCount > 0 && (
                    <button onClick={cancelRemaining} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700">
                      Cancel remaining
                    </button>
                  )
                ) : finished ? (
                  <>
                    {(failedCount > 0 || items.some((i) => i.status === 'cancelled')) && (
                      <button onClick={retryFailed} className="px-4 py-2.5 rounded-xl text-sm font-bold text-slate-300 bg-slate-800 hover:bg-slate-700">
                        Retry failed
                      </button>
                    )}
                    <button onClick={handleClose} className="px-6 py-2.5 primary-gradient text-white rounded-xl font-headline font-bold text-sm">
                      Done
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => void runQueue()}
                    disabled={readyCount === 0}
                    className="px-6 py-2.5 primary-gradient text-white rounded-xl font-headline font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Upload {readyCount} file{readyCount === 1 ? '' : 's'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
