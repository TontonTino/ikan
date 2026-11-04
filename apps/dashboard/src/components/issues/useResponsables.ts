import { useCallback, useEffect, useState } from 'react';
import { utilisateursApi } from '../../services/api';
import type { UtilisateurListe } from '../../utils/actionsProbleme';

export type EtatResponsables = { statut: 'chargement' } | { statut: 'erreur' } | { statut: 'ok'; utilisateurs: UtilisateurListe[] };

/**
 * Personnes connues du CX Manager (`GET /utilisateurs/` : les Agency Managers de son organisation, avec leur agence). Sert à proposer des responsables
 * du périmètre du problème et à afficher leur nom. Réservé au CX Manager : l'API refuse cette liste à l'Agency Manager (`actif` = false, aucun appel).
 */
export function useResponsables(actif: boolean): { etat: EtatResponsables; recharger: () => void } {
  const [etat, setEtat] = useState<EtatResponsables>({ statut: 'chargement' });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    if (!actif) return undefined;
    let annule = false;
    setEtat({ statut: 'chargement' });
    utilisateursApi
      .list()
      .then((r) => { if (!annule) setEtat({ statut: 'ok', utilisateurs: r.data as UtilisateurListe[] }); })
      .catch(() => { if (!annule) setEtat({ statut: 'erreur' }); });
    return () => { annule = true; };
  }, [actif, essai]);

  const recharger = useCallback(() => setEssai((n) => n + 1), []);
  return { etat, recharger };
}
