import React from 'react';
import EmptyState from '../../components/ui/EmptyState';

interface Props {
  chargement: boolean;
  erreur: boolean;
  /** Nombre d'avis correspondant aux filtres actuels (total serveur). */
  total: number;
  /** Au moins un filtre, une recherche ou un onglet actif : « aucun résultat » n'est alors pas « aucun avis ». */
  filtresActifs: boolean;
  onReessayer: () => void;
  onReinitialiser: () => void;
}

/** Message affiché à la place de la liste : chargement, erreur, aucun résultat pour ces critères, ou aucun avis du tout. */
export default function EtatListeAvis({ chargement, erreur, total, filtresActifs, onReessayer, onReinitialiser }: Props) {
  if (chargement) {
    return <div role="status" aria-busy="true" className="feedbacks-etat">Chargement des avis…</div>;
  }
  if (erreur) {
    return (
      <EmptyState
        illustration="no-data"
        title="Impossible de charger les avis"
        message="Une erreur est survenue lors du chargement. Vérifiez votre connexion puis réessayez."
        action={{ label: 'Réessayer', onClick: onReessayer }}
      />
    );
  }
  if (total > 0) return null;
  if (filtresActifs) {
    return (
      <EmptyState
        illustration="no-feedback"
        title="Aucun avis ne correspond à ces critères."
        message="Modifiez la recherche ou les filtres, ou réinitialisez-les pour revoir tous les avis."
        action={{ label: 'Réinitialiser les filtres', onClick: onReinitialiser }}
      />
    );
  }
  return (
    <EmptyState
      illustration="no-feedback"
      title="Aucun avis dans ce périmètre"
      message="Aucun avis client n’a encore été reçu pour l’agence ou le périmètre sélectionné."
    />
  );
}
