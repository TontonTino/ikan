/**
 * État d'ouverture du panneau YAM, partagé entre la sidebar (entrée générale)
 * et les entrées contextuelles des pages (« Demander à YAM » sur une agence,
 * un thème…). YAM reste fermé par défaut.
 *
 * Une question contextuelle est PRÉ-REMPLIE dans le champ de saisie, jamais
 * envoyée automatiquement : l'utilisateur relit, ajuste et envoie.
 *
 * ⚠ DETTE TECHNIQUE — contexte agence de YAM (voir apps/dashboard/DETTE-TECHNIQUE.md)
 * Aujourd'hui, une question sur une agence ne contient que son NOM, en texte libre ;
 * aucun agence_id n'est transmis à POST /agent/ask.
 *
 *   RÈGLE : le nom d'agence fourni dans le prompt YAM NE constitue JAMAIS une autorisation.
 *
 * Le périmètre de données de YAM reste celui du JWT de l'utilisateur (filtrage côté
 * service agent). Cible : Session utilisateur → agence autorisée → agence_id déterminé
 * côté serveur → contexte YAM. Jamais : nom d'agence saisi → autorisation.
 */
import { create } from 'zustand';

interface YamState {
  open: boolean;
  /** Question à pré-remplir ; `nonce` change à chaque demande (même texte redemandé). */
  prefill: { text: string; nonce: number } | null;
  toggle: () => void;
  close: () => void;
  /** Ouvre YAM avec une question pré-remplie. */
  ask: (question: string) => void;
}

export const useYamStore = create<YamState>((set) => ({
  open: false,
  prefill: null,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
  ask: (question) => set({ open: true, prefill: { text: question, nonce: Date.now() } }),
}));
