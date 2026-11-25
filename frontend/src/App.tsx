import { lazy, Suspense } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import AppShell from './components/layout/AppShell';
import Home from './pages/Home';
import Library from './pages/Library';
import NotFound from './pages/NotFound';

// The chat view pulls in the markdown renderer; load it on demand.
const Results = lazy(() => import('./pages/Results'));

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500" role="status">
      <span className="material-symbols-outlined animate-spin">progress_activity</span>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Home />} />
          <Route
            path="/results"
            element={
              <Suspense fallback={<PageFallback />}>
                <Results />
              </Suspense>
            }
          />
          <Route path="/library" element={<Library />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  );
}
