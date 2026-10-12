import React from 'react';
import { Link } from 'react-router-dom';
import type { Issue, IssueStatut } from '../../types';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { ArrowUpRightIcon } from '../common/Icons';
import { PROBLEMES_OUVERTS } from './agenceVue';

export type ProblemesSnapshot = { items: Issue[]; totals: Record<IssueStatut, number>; truncated: boolean };

/**
 * Suivi des problèmes (toutes périodes). « Résolu » et « Résolution vérifiée » sont des statuts déclarés par les équipes :
 * ils ne prouvent pas, à eux seuls, une amélioration de la satisfaction.
 */
export default function AgencyProblemes({ snapshot, failed, onRetry }: { snapshot: ProblemesSnapshot | null; failed: boolean; onRetry: () => void }) {
  return (
    <Card
      title="Suivi des problèmes"
      subtitle="Toutes périodes. Un problème est un sujet que vos équipes ont décidé de suivre ; il se distingue d’un avis et d’une action à mener."
      actions={
        <Link to="/issues" className="siege-link">
          Voir les problèmes
          <ArrowUpRightIcon size={13} aria-hidden="true" />
        </Link>
      }
    >
      {failed || !snapshot ? (
        failed ? (
          <Alert tone="warning" title="Le statut des problèmes est indisponible pour le moment." action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>} />
        ) : (
          <p role="status" className="siege-note">Chargement du statut des problèmes…</p>
        )
      ) : (
        <>
          <dl className="agence-stats">
            <div className="agence-stat">
              <dt>Encore à traiter</dt>
              <dd>{PROBLEMES_OUVERTS.reduce((total, statut) => total + snapshot.totals[statut], 0)}</dd>
            </div>
            <div className="agence-stat">
              <dt>Résolus</dt>
              <dd>{snapshot.totals.resolue}</dd>
            </div>
            <div className="agence-stat">
              <dt>Résolution vérifiée</dt>
              <dd>{snapshot.totals.verifiee}</dd>
            </div>
          </dl>
          {snapshot.truncated && <p className="siege-note">Liste partielle : seuls les premiers problèmes de chaque statut sont chargés pour établir les priorités.</p>}
        </>
      )}
    </Card>
  );
}
