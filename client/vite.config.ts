/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development so the httpOnly refresh cookie (SameSite=Strict) just works.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks so returning guests on slow networks re-download only app code.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/](react|react-dom|react-router|scheduler)[\/]/.test(id)) return 'react';
          if (/[\/](@tanstack|axios)[\/]/.test(id)) return 'data';
          if (/[\/](react-hook-form|@hookform|zod)[\/]/.test(id)) return 'forms';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
