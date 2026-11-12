/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VARIABLES_BUILD, messageVariablesManquantes, variablesManquantes } from './variables-requises.mjs';

export default defineConfig(({ command, mode }) => {
  // Build de production : les adresses des services doivent venir de l'environnement (aucun repli codé en dur).
  if (command === 'build' && mode === 'production') {
    const manquantes = variablesManquantes(loadEnv(mode, process.cwd(), 'VITE_'), VARIABLES_BUILD);
    if (manquantes.length) throw new Error(messageVariablesManquantes(manquantes, 'Build de production'));
  }

  return {
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
  };
});
