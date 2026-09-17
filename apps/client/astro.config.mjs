import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
  server: {
    port: 4321,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  vite: {
    server: {
      allowedHosts: true,
      proxy: {
        '/api/v1': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  },
});
