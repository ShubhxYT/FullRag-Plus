import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Source } from './types';

export type PanelTab = 'sources' | 'library';
export type CitePeek = { n: number; source: Source } | null;

interface LayoutState {
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  collapsed: boolean;
  navOpen: boolean;
  panelOpen: boolean;
  peek: CitePeek;
  setPeek: (peek: CitePeek) => void;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  togglePanel: () => void;
  openNav: () => void;
  closeDrawers: () => void;
  isNarrow: () => boolean;
  isMobile: () => boolean;
}

const LayoutContext = createContext<LayoutState | null>(null);

const COLLAPSE_KEY = 'fullrag.panelCollapsed';

function narrow() {
  return window.matchMedia('(max-width: 1100px)').matches;
}
function mobile() {
  return window.matchMedia('(max-width: 760px)').matches;
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<PanelTab>('sources');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [peek, setPeek] = useState<CitePeek>(null);

  const persistCollapsed = (value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const closeDrawers = useCallback(() => {
    setNavOpen(false);
    setPanelOpen(false);
  }, []);

  const openPanel = useCallback((next?: PanelTab) => {
    if (next) setTab(next);
    persistCollapsed(false);
    setNavOpen(false);
    if (narrow()) setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    if (narrow()) {
      setPanelOpen(false);
    } else {
      persistCollapsed(true);
    }
  }, []);

  const togglePanel = useCallback(() => {
    if (narrow()) {
      setPanelOpen((open) => {
        if (open) return false;
        setNavOpen(false);
        persistCollapsed(false);
        return true;
      });
    } else {
      persistCollapsed(!collapsed);
    }
  }, [collapsed]);

  const openNav = useCallback(() => {
    setPanelOpen(false);
    setNavOpen((v) => !v);
  }, []);

  const value = useMemo<LayoutState>(
    () => ({
      tab,
      setTab,
      collapsed,
      navOpen,
      panelOpen,
      peek,
      setPeek,
      openPanel,
      closePanel,
      togglePanel,
      openNav,
      closeDrawers,
      isNarrow: narrow,
      isMobile: mobile,
    }),
    [tab, collapsed, navOpen, panelOpen, peek, openPanel, closePanel, togglePanel, openNav, closeDrawers],
  );

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
