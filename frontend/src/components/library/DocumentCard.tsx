import type { DocumentItem } from '../../lib/types';

interface Props {
  document: DocumentItem;
  selecting?: boolean;
  selected?: boolean;
  deleting?: boolean;
  onToggleSelect?: (id: string) => void;
  onDelete?: (doc: DocumentItem) => void;
}

/** A document with no chunks that was added in the last few minutes is still being indexed. */
export function isDocProcessing(doc: DocumentItem) {
  return doc.chunk_count === 0 && Date.now() - new Date(doc.created_at).getTime() < 10 * 60_000;
}

function getDocIcon(path: string): string {
  if (path.endsWith('.pdf')) return 'description';
  if (path.endsWith('.docx')) return 'article';
  if (path.endsWith('.csv')) return 'data_table';
  if (path.endsWith('.md')) return 'text_snippet';
  if (path.endsWith('.html')) return 'web';
  return 'draft';
}

/** Older uploads were titled after their random temp file ("tmpmuz366ta"); show the file name instead. */
export function displayTitle(title: string | null | undefined, sourcePath: string) {
  const file = sourcePath.split('/').pop() || sourcePath;
  if (!title || /^tmp[a-z0-9_]{5,}$/i.test(title)) return file.replace(/\.[^.]+$/, '') || file;
  return title;
}

export default function DocumentCard({
  document: doc,
  selecting = false,
  selected = false,
  deleting = false,
  onToggleSelect,
  onDelete,
}: Props) {
  const isProcessing = isDocProcessing(doc);
  const name = displayTitle(doc.title, doc.source_path);

  return (
    <div
      data-testid="doc-card"
      data-doc-id={doc.id}
      onClick={selecting && !isProcessing ? () => onToggleSelect?.(doc.id) : undefined}
      className={`relative bg-slate-800/50 p-6 rounded-xl border transition-all group ${
        selected ? 'border-indigo-400/70 bg-indigo-500/10' : 'border-transparent hover:shadow-2xl hover:shadow-indigo-500/5'
      } ${selecting && !isProcessing ? 'cursor-pointer' : ''} ${deleting ? 'opacity-40 pointer-events-none' : ''}`}
    >
      <div className="flex justify-between items-start mb-4 gap-2">
        {selecting ? (
          <label className="p-3 flex items-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              disabled={isProcessing}
              onChange={() => onToggleSelect?.(doc.id)}
              aria-label={`Select ${name}`}
              className="w-5 h-5 accent-indigo-500 disabled:opacity-40"
            />
          </label>
        ) : (
          <div className="p-3 bg-indigo-900/40 rounded-lg text-primary">
            <span className="material-symbols-outlined">
              {getDocIcon(doc.source_path)}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
        {isProcessing ? (
          <div className="flex items-center gap-2">
            <span className="animate-pulse w-2 h-2 rounded-full bg-primary" />
            <span className="text-[10px] font-bold tracking-widest uppercase text-primary">
              Processing
            </span>
          </div>
        ) : (
          <span className="bg-tertiary-fixed-dim text-on-tertiary-fixed px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase">
            Indexed
          </span>
        )}
        {!selecting && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(doc);
            }}
            disabled={isProcessing || deleting}
            title={isProcessing ? 'Can be deleted once processing finishes' : 'Delete document'}
            aria-label={`Delete ${name}`}
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-950/40 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-lg">delete</span>
          </button>
        )}
        </div>
      </div>

      <h3 className="font-headline font-bold text-lg mb-1 group-hover:text-primary transition-colors">
        {name}
      </h3>
      <p className="text-xs font-medium text-outline mb-6 flex items-center gap-1">
        <span className="material-symbols-outlined text-[14px]">
          folder_open
        </span>
        {doc.source_path}
      </p>

      <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
        <span className="text-xs font-semibold text-on-surface-variant">
          {isProcessing
            ? 'Calculating...'
            : `${doc.chunk_count.toLocaleString()} Chunks`}
        </span>
        <span className="text-xs text-outline italic">
          {new Date(doc.created_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
