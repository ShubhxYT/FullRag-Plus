import { type ReactNode } from 'react';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import { useHealth, healthDotClass } from '../../lib/useHealth';

export default function AppShell({ children }: { children: ReactNode }) {
  const health = useHealth();
  return (
    <div className="min-h-screen bg-slate-950 text-on-surface">
      <Sidebar />

      {/* Mobile Header */}
      <header className="md:hidden fixed top-0 w-full z-50 bg-slate-950/80 backdrop-blur-xl px-6 py-3 flex justify-between items-center">
        <h1 className="text-xl font-bold text-indigo-400 font-headline tracking-tight">
          FullRag
        </h1>
        <div className="flex items-center gap-2" role="status">
          <span className={`w-2 h-2 rounded-full ${healthDotClass[health.state]}`} />
          <span className="text-[10px] font-label font-semibold uppercase tracking-widest text-slate-400">
            {health.label}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen flex flex-col pt-14 md:pt-0 pb-20 md:pb-0">
        {children}
      </main>

      <MobileNav />
    </div>
  );
}
