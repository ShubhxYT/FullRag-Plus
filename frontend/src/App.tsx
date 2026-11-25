import { lazy, Suspense } from 'react';
import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import AppShell from './components/layout/AppShell';
import Home from './pages/Home';
import Library from './pages/Library';
import History from './pages/History';
import NotFound from './pages/NotFound';
import StartChat from './pages/StartChat';
import { getConversation } from './lib/chatStore';
import { useChatState } from './lib/useChatStore';

// The chat view pulls in the markdown renderer; load it on demand.
const Chat = lazy(() => import('./pages/Chat'));

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500" role="status">
      <span className="material-symbols-outlined animate-spin">progress_activity</span>
    </div>
  );
}

/** Discover: reopen the active conversation if there is one, else the search page. */
function Discover() {
  const { activeId } = useChatState();
  const active = getConversation(activeId);
  if (active && active.turns.length > 0) return <Navigate to={`/chat/${active.id}`} replace />;
  return <Home />;
}

export default function App() {
  const location = useLocation();
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Discover />} />
          <Route path="/results" element={<StartChat />} />
          <Route
            path="/chat/:id"
            element={
              <Suspense fallback={<PageFallback />}>
                <Chat />
              </Suspense>
            }
          />
          <Route path="/history" element={<History />} />
          <Route path="/library" element={<Library />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  );
}
