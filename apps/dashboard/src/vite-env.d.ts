/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** « oui » uniquement dans le build de la démonstration publique (demo.ikanai.bf). */
  readonly VITE_DEMO_MODE?: string;
}
