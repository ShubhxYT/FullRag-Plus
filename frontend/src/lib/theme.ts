const KEY = 'fullrag.theme';
const listeners = new Set<() => void>();

export type Theme = 'light' | 'dark';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let current: Theme = read();

export function getTheme(): Theme {
  return current;
}

export function applyTheme(theme: Theme) {
  current = theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme !== 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f2ee' : '#101215');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
