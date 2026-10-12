import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Alert from '../ui/Alert';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { ArrowUpRightIcon } from '../common/Icons';
import type { Priorite, PrioriteKind } from './agenceVue';

/** Nombre d'éléments visibles d'emblée ; les suivants se déplient (progressive disclosure). */
export const PRIORITES_VISIBLES = 4;

const PLURIEL: Record<PrioriteKind, [string, string]> = {
  seuil: ['alerte de seuil', 'alertes de seuil'],
  probleme: ['problème à traiter', 'problèmes à traiter'],
  avis: ['avis à examiner', 'avis à examiner'],
};

export function resumePriorites(priorites: Priorite[]): string {
  return (Object.keys(PLURIEL) as PrioriteKind[])
    .map((kind) => {
      const n = priorites.filter((p) => p.kind === kind).length;
      return n ? `${n} ${PLURIEL[kind][n > 1 ? 1 : 0]}` : null;
    })
    .filter(Boolean)
    .join(' · ');
}

function Ligne({ priorite }: { priorite: Priorite }) {
  return (
    <li className={`agence-prio__item agence-prio__item--${priorite.ton}`}>
      <div className="agence-prio__main">
        <div className="agence-prio__head">
          <Badge variant={priorite.ton} label={priorite.type} />
          <h3 className="agence-prio__title">{priorite.titre}</h3>
        </div>
        <p className="agence-prio__detail">{priorite.detail}</p>
      </div>
      <Link to={priorite.lien.to} className="siege-link">
        {priorite.lien.label}
        <ArrowUpRightIcon size={13} aria-hidden="true" />
      </Link>
    </li>
  );
}

interface Props {
  priorites: Priorite[];
  loading: boolean;
  /** Sources en échec : une absence de donnée ne doit jamais être présentée comme « rien à signaler ». */
  alertesIndisponibles: boolean;
  problemesIndisponibles: boolean;
  /** Avis de la période non résolus (ou avec une demande de rappel en attente), selon l'API. */
  avisATraiter: number;
  /** Période de ce décompte (ex. « 30 derniers jours »), pour ne pas le confondre avec la liste complète des avis. */
  periode?: string;
  onRetry: () => void;
}

export default function AgencyPriorities({ priorites, loading, alertesIndisponibles, problemesIndisponibles, avisATraiter, periode, onRetry }: Props) {
  const [depliee, setDepliee] = useState(false);
  const toutesIndisponibles = alertesIndisponibles && problemesIndisponibles;
  const visibles = depliee ? priorites : priorites.slice(0, PRIORITES_VISIBLES);
  const cachees = priorites.length - visibles.length;
  const indisponibles = [alertesIndisponibles && 'les alertes', problemesIndisponibles && 'les problèmes à traiter'].filter(Boolean).join(' et ');

  return (
    <Card
      title="À traiter en priorité"
      subtitle={loading ? 'Analyse des signaux…' : priorites.length ? resumePriorites(priorites) : undefined}
      tone={priorites.some((p) => p.ton === 'critical') ? 'critical' : 'default'}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <div className="agence-prio">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={72} radius="var(--radius-md)" />)}
        </div>
      ) : toutesIndisponibles ? (
        <Alert
          tone="warning"
          title="Impossible de vérifier les alertes et les problèmes pour le moment."
          action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>}
        />
      ) : (
        <>
          {(alertesIndisponibles || problemesIndisponibles) && (
            <Alert
              tone="warning"
              title={`Non vérifié : ${indisponibles}. Les autres signaux restent affichés.`}
              action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>}
            />
          )}
          {priorites.length === 0 ? (
            <EmptyState
              compact
              illustration={alertesIndisponibles || problemesIndisponibles ? null : 'no-alert'}
              title={alertesIndisponibles || problemesIndisponibles ? 'Aucun signal dans les données vérifiées' : 'Aucune priorité détectée'}
              message="Aucune alerte de seuil, aucun problème grave ni avis à examiner dans les données disponibles."
            />
          ) : (
            <>
              <ul className="agence-prio" aria-label="Priorités de l’agence">
                {visibles.map((p) => <Ligne key={p.id} priorite={p} />)}
              </ul>
              {(cachees > 0 || depliee) && priorites.length > PRIORITES_VISIBLES && (
                <Button className="agence-more" size="sm" variant="ghost" aria-expanded={depliee} onClick={() => setDepliee((v) => !v)}>
                  {depliee ? 'Réduire la liste' : `Afficher les ${cachees} autre${cachees > 1 ? 's' : ''} priorité${cachees > 1 ? 's' : ''}`}
                </Button>
              )}
            </>
          )}
          <div className="siege-foot">
            <p className="siege-note">
              Une alerte signale une situation, un avis est un retour client, un problème est un sujet suivi par vos équipes : l’un ne crée pas automatiquement l’autre.
            </p>
            <span className="siege-foot__actions">
              <Link to="/feedbacks?tab=a_traiter" className="siege-link">
                {avisATraiter} avis à traiter{periode ? ` (${periode})` : ''}
                <ArrowUpRightIcon size={13} aria-hidden="true" />
              </Link>
              <Link to="/alertes" className="siege-link">
                Toutes les alertes
                <ArrowUpRightIcon size={13} aria-hidden="true" />
              </Link>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
