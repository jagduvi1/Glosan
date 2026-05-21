import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'build',
    // Manual chunks så vendor-deps får egen cache som överlever app-deploys.
    // React + router stannar i en chunk; socket.io ligger redan i sin egen
    // (lazy-loadad i LiveDuel).
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom']
        }
      }
    }
  },
  // Strippa console.* och debugger ur prod-bundlen. ErrorBoundary använder
  // `import.meta.env.DEV` separat så dess dev-log finns kvar i utvecklarna.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
  }
});
