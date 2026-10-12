/** Paramètres de GET /feedbacks/demandes-contact : l'agence du contexte est transmise au serveur (jamais filtrée côté navigateur). */
export function parametresDemandes(traitees: boolean, agenceFiltre: string | null | undefined, offset: number) {
  return { traitee: traitees, limit: 50, offset, ...(agenceFiltre ? { agence_id: agenceFiltre } : {}) };
}
