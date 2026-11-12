import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import { loadEnv } from 'vite';
import { adresseApi } from './serveur/adresse-api.mjs';

// Build de production : PUBLIC_API_URL est inscrite dans le code au build, elle doit donc exister à ce moment-là.
// Absente, le build s'arrête en la nommant (voir serveur/adresse-api.mjs) au lieu de viser une ancienne adresse.
const exigerAdresseApi = {
  name: 'ikan-exiger-adresse-api',
  hooks: {
    'astro:config:setup': ({ command }) => {
      if (command !== 'build') return;
      adresseApi(loadEnv('production', process.cwd(), 'PUBLIC_').PUBLIC_API_URL, true);
    },
  },
};

export default defineConfig({
  output: 'server',
  integrations: [exigerAdresseApi],
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
