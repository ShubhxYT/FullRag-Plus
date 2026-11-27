import { useEffect } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useConversation, useChatState } from '../../lib/useChatStore';
import { getConversation } from '../../lib/chatStore';
import { useLayout } from '../../lib/layout';
import { getTheme, subscribeTheme, toggleTheme } from '../../lib/theme';
import { useSyncExternalStore } from 'react';
import HistorySidebar from './HistorySidebar';
import SidePanel from './SidePanel';
import { IconMenu, IconMoon, IconPanel, IconSun } from '../icons';

export default function AppShell() {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const { conversation } = useConversation(id);
  const { activeId } = useChatState();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  const { collapsed, navOpen, panelOpen, closeDrawers, togglePanel, openNav, isMobile, setPeek } = useLayout();

  const active = conversation ?? getConversation(id ?? activeId);
  const title =
    (pathname.startsWith('/chat/') && active?.title) ||
    (pathname === '/library' ? 'Library' : pathname === '/history' ? 'History' : active?.title) ||
    'New chat';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeDrawers();
        setPeek(null);
      }
    };
    const onResize = () => {
      if (!window.matchMedia('(max-width: 1100px)').matches) closeDrawers();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [closeDrawers, setPeek]);

  const classes = [
    'app-shell',
    collapsed ? 'panel-collapsed' : '',
    navOpen ? 'nav-open' : '',
    panelOpen ? 'panel-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} id="app-shell">
      <HistorySidebar />

      <div className="chat-column">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn menu-btn"
            style={{ display: 'none' }}
            aria-label="Open history"
            onClick={openNav}
          >
            <IconMenu className="icon-lg" />
          </button>
          <h2 title={title}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <IconSun className="icon-lg" /> : <IconMoon className="icon-lg" />}
          </button>
          <button
            type="button"
            className={`icon-btn ${!collapsed || panelOpen ? 'active' : ''}`}
            onClick={togglePanel}
            aria-label="Toggle sources panel"
            title="Sources & library"
            aria-pressed={!collapsed || panelOpen}
          >
            <IconPanel className="icon-lg" />
          </button>
        </header>
        <Outlet />
      </div>

      <SidePanel />
      <div
        className={`scrim ${(navOpen || (panelOpen && (isMobile() || window.matchMedia('(max-width: 1100px)').matches))) ? 'show' : ''}`}
        onClick={closeDrawers}
      />
    </div>
  );
}
