import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.4 } }}
      exit={{ opacity: 0, y: -20, transition: { duration: 0.2 } }}
      className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16"
    >
      <span className="material-symbols-outlined text-5xl text-indigo-400 mb-4">explore_off</span>
      <h1 className="text-3xl font-extrabold font-headline text-white mb-2">Page not found</h1>
      <p className="text-slate-400 mb-8 max-w-md">
        This page doesn&apos;t exist. Head back to search or browse your library.
      </p>
      <div className="flex gap-3">
        <Link
          to="/"
          className="px-6 py-3 primary-gradient text-white rounded-full font-headline font-bold text-sm"
        >
          New search
        </Link>
        <Link
          to="/library"
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-full font-headline font-bold text-sm"
        >
          Library
        </Link>
      </div>
    </motion.div>
  );
}
