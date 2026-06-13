import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // The server reverse-proxies GoTrue under /auth; forward it in dev too.
      '/auth': 'http://localhost:3001',
    },
  },
});
