import { useLayout } from '../../lib/layout';
import { IconClose } from '../icons';
import SourcesPane from './SourcesPane';
import LibraryPane from './LibraryPane';

export default function SidePanel() {
  const { tab, setTab, closePanel } = useLayout();

  return (
    <aside className="side-panel" id="side-panel" aria-label="Sources and library">
      <div className="flex items-center gap-1.5 px-3 border-b shrink-0" style={{ height: 'var(--header-h)', borderColor: 'var(--border)' }}>
        <div
          className="flex flex-1 gap-0.5 p-0.5 rounded-lg border"
          style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'sources'}
            className="tab-btn flex-1 h-7 rounded-md text-[12.5px] font-semibold"
            style={{
              background: tab === 'sources' ? 'var(--bg-elev)' : 'transparent',
              color: tab === 'sources' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: tab === 'sources' ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
            }}
            onClick={() => setTab('sources')}
          >
            Sources
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            className="tab-btn flex-1 h-7 rounded-md text-[12.5px] font-semibold"
            style={{
              background: tab === 'library' ? 'var(--bg-elev)' : 'transparent',
              color: tab === 'library' ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: tab === 'library' ? '0 1px 2px rgba(0,0,0,.12)' : 'none',
            }}
            onClick={() => setTab('library')}
          >
            Library
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Close panel" onClick={closePanel}>
          <IconClose />
        </button>
      </div>
      {tab === 'sources' ? <SourcesPane /> : <LibraryPane />}
    </aside>
  );
}
