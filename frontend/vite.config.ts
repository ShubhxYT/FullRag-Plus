import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // Backend the dev/preview server proxies /api to. Override with e.g.
  //   VITE_PROXY_TARGET=https://rag.shubhsomani.tech npm run dev
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8001';
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
      secure: false,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };

  return {
    plugins: [react()],
    server: { host: '0.0.0.0', port: 5173, proxy },
    preview: { host: '0.0.0.0', port: 4173, proxy },
  };
});
