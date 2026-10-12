import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { issuesApi } from '../../services/api';

/**
 * Renvoie vers les actions rattachées à des problèmes. L'API ne propose pas de liste globale de
 * ces actions (elles ne sont consultables que dans le détail d'un problème) : on compte seulement
 * les problèmes au statut « Action en cours », sans inventer le nombre d'actions.
 */
export default function ProblemesAvecActionsNote() {
  const [etat, setEtat] = useState<{ statut: 'chargement' } | { statut: 'ok'; total: number } | { statut: 'erreur' }>({ statut: 'chargement' });

  useEffect(() => {
    let annule = false;
    issuesApi
      .list({ statut: 'action_en_cours', limit: 1, offset: 0 })
      .then((r) => { if (!annule) setEtat({ statut: 'ok', total: Number(r.headers?.['x-total-count'] || 0) }); })
      .catch((err) => {
        console.error('Erreur comptage des problèmes avec action en cours:', err);
        if (!annule) setEtat({ statut: 'erreur' });
      });
    return () => { annule = true; };
  }, []);

  const resume =
    etat.statut === 'chargement'
      ? 'Vérification des problèmes en cours de traitement…'
      : etat.statut === 'erreur'
        ? 'Le nombre de problèmes avec action en cours n’a pas pu être chargé.'
        : etat.total === 0
          ? 'Aucun problème n’a d’action en cours pour le moment.'
          : `${etat.total} problème${etat.total > 1 ? 's ont' : ' a'} une action en cours.`;

  return (
    <div className="ui-item__meta" style={{ gap: 'var(--space-3)' }}>
      <span>{resume}</span>
      <Link to="/issues" className="ui-item__link" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
        Ouvrir les problèmes à traiter
      </Link>
    </div>
  );
}
