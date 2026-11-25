import { NavLink, useNavigate } from 'react-router-dom';
import { useHealth, healthDotClass } from '../../lib/useHealth';

// Placeholders from the design that have no backend yet: rendered disabled
// (with a "Soon" tag) instead of as buttons that silently do nothing.
function SoonItem({ icon, label, compact }: { icon: string; label: string; compact?: boolean }) {
  return (
    <div
      aria-disabled="true"
      title="Coming soon"
      className={`w-full flex items-center gap-3 font-headline text-sm font-medium text-slate-600 cursor-not-allowed select-none px-4 ${compact ? 'py-2' : 'py-3'} rounded-xl`}
    >
      <span className="material-symbols-outlined">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[9px] uppercase tracking-widest text-slate-600 border border-slate-700/60 rounded-full px-1.5 py-0.5">
        Soon
      </span>
    </div>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const health = useHealth();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 font-headline text-sm font-medium px-4 py-3 rounded-xl transition-all duration-300 ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-300'
        : 'text-slate-400 hover:text-indigo-300 hover:bg-slate-800/50'
    }`;

  return (
    <aside className="hidden md:flex flex-col h-screen w-64 bg-slate-900/80 backdrop-blur-xl fixed left-0 top-0 py-8 px-4 z-50">
      {/* Logo */}
      <div className="mb-10 px-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg">
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-50 font-headline leading-tight">
              FullRag
            </h1>
            <p className="text-[10px] text-slate-500 font-medium tracking-widest uppercase">
              The Intellectual Sanctuary
            </p>
          </div>
        </div>
      </div>

      {/* New Research CTA */}
      <button
        onClick={() => navigate('/')}
        className="w-full py-3 mb-6 primary-gradient text-white rounded-xl font-headline font-bold text-sm tracking-wide shadow-md hover:scale-[0.98] transition-transform"
      >
        New Research
      </button>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        <NavLink to="/" end className={linkClass}>
          <span className="material-symbols-outlined">explore</span>
          Discover
        </NavLink>
        <NavLink to="/library" className={linkClass}>
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            library_books
          </span>
          Library
        </NavLink>
        <SoonItem icon="folder_shared" label="Collections" />
        <SoonItem icon="history" label="History" />
      </nav>

      {/* Bottom Section */}
      <div className="mt-auto space-y-4 pt-6 border-t border-slate-800/50">
        <div className="space-y-1">
          <SoonItem icon="settings" label="Settings" compact />
          <SoonItem icon="help" label="Support" compact />
        </div>
        <div
          className="flex items-center gap-2 px-4 py-2 opacity-70"
          role="status"
          title={health.data ? `API: ${health.data.status}, database: ${health.data.database}` : undefined}
        >
          <div className={`w-2 h-2 rounded-full ${healthDotClass[health.state]} ${health.state === 'ok' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-label font-medium uppercase tracking-tighter">
            {health.label}
          </span>
        </div>
      </div>
    </aside>
  );
}
