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
    // Vite 8 bygger med Rolldown (och minifierar med Oxc) — därav
    // rolldownOptions. De gäller bara bygget, aldrig dev-servern.
    rolldownOptions: {
      output: {
        // Vendor-deps i en egen chunk som överlever app-deploys. React +
        // router stannar i en chunk; socket.io ligger redan i sin egen
        // (lazy-loadad i LiveDuel).
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/,
              priority: 20
            }
          ]
        },
        // Strippa console.* och debugger ur prod-bundlen. ErrorBoundary
        // använder `import.meta.env.DEV` separat så dess dev-log finns kvar
        // i utvecklarna.
        minify: { compress: { dropConsole: true, dropDebugger: true } }
      }
    }
  }
});
