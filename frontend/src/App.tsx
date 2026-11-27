import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import { LayoutProvider, useLayout } from './lib/layout';
import { getConversation } from './lib/chatStore';
import { useChatState } from './lib/useChatStore';

const Chat = lazy(() => import('./pages/Chat'));
const StartChat = lazy(() => import('./pages/StartChat'));
const NotFound = lazy(() => import('./pages/NotFound'));

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-faint)' }} role="status">
      Loading…
    </div>
  );
}

/** Reopen the active conversation if there is one, else a new empty chat. */
function Discover() {
  const { activeId } = useChatState();
  const active = getConversation(activeId);
  if (active && active.turns.length > 0) return <Navigate to={`/chat/${active.id}`} replace />;
  return <Chat />;
}

function LibraryRoute() {
  const { openPanel } = useLayout();
  useEffect(() => {
    openPanel('library');
  }, [openPanel]);
  return <Discover />;
}

function HistoryRoute() {
  const { openNav, isMobile } = useLayout();
  useEffect(() => {
    if (isMobile()) openNav();
  }, [openNav, isMobile]);
  return <Discover />;
}

export default function App() {
  const location = useLocation();
  return (
    <LayoutProvider>
      <Suspense fallback={<PageFallback />}>
        <Routes location={location}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Discover />} />
            <Route path="/results" element={<StartChat />} />
            <Route path="/chat/:id" element={<Chat />} />
            <Route path="/history" element={<HistoryRoute />} />
            <Route path="/library" element={<LibraryRoute />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </LayoutProvider>
  );
}
