/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Seule la feuille d'impression du QR est traitée par les tests : ils vérifient son contenu (masquage du dashboard, A4…).
    css: { include: [/ficheQr\.css/] },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
