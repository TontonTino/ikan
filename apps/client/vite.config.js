import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    allowedHosts: true,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
