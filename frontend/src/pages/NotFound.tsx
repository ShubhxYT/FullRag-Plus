import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Page not found</h1>
      <p className="mb-8 max-w-md" style={{ color: 'var(--text-muted)' }}>
        This page doesn&apos;t exist. Head back to a new chat or open your library.
      </p>
      <div className="flex gap-3">
        <Link to="/" className="btn btn-primary">
          New chat
        </Link>
        <Link to="/library" className="btn">
          Library
        </Link>
      </div>
    </div>
  );
}
