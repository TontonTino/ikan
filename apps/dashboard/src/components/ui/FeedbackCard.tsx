import React from 'react';
import type { CriticiteType, Feedback, SentimentType, StatutTraitement } from '../../types';
import { themeLabel } from '../../utils/themeLabels';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS, SENTIMENT_LABELS } from '../../utils/vocabulaire';
import Badge from './Badge';
import Card from './Card';
import { fullDate, relativeTime } from './format';

const SENTIMENT_LABEL: Record<SentimentType, string> = SENTIMENT_LABELS;
const CRITICITE_LABEL: Record<CriticiteType, string> = GRAVITE_LABELS;
const STATUT_LABEL: Record<StatutTraitement, string> = AVIS_STATUT_LABELS;
const STATUT_TONE: Record<StatutTraitement, 'critical' | 'info' | 'warning' | 'success'> = {
  nouveau: 'critical',
  en_traitement: 'info',
  en_cours: 'warning',
  resolu: 'success',
};

export interface FeedbackCardProps {
  feedback: Feedback;
  /** Affiche le nom d'agence (vue réseau CX). À false pour l'Agency Manager. */
  showAgency?: boolean;
  /** Ouvre le détail / traitement du feedback. */
  onOpen?: (feedback: Feedback) => void;
  /** Actions contextuelles (ex. « Créer une action »). */
  actions?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
}

function Rating({ note }: { note: number }) {
  const n = Math.max(0, Math.min(5, Math.round(note)));
  return (
    <span className="ui-rating" aria-label={`Note : ${note} sur 5`}>
      <span className="ui-rating__stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <svg key={i} width="12" height="12" viewBox="0 0 24 24" className={i < n ? undefined : 'ui-rating__star--off'} fill="currentColor">
            <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.3L12 17.8 5.7 21.5l1.7-7.3L2 9.5l7.1-.6z" />
          </svg>
        ))}
      </span>
      <span aria-hidden="true">{note}/5</span>
    </span>
  );
}

/**
 * Feedback CLIENT (donnée collectée par IKAN AI) — à ne pas confondre avec le
 * retour utilisateur sur l'outil. Affiche note, sentiment, criticité, thème,
 * statut : chaque information est textuelle, la couleur n'est qu'un renfort.
 */
export default function FeedbackCard({ feedback, showAgency = false, onOpen, actions, headingLevel = 3 }: FeedbackCardProps) {
  const ia = feedback.analyse_ia;
  const isCritical = ia?.criticite === 'critique';
  const statut = feedback.statut_traitement;
  const Heading = `h${headingLevel}` as React.ElementType;

  return (
    <Card
      as="article"
      padding="sm"
      tone={isCritical ? 'critical' : 'default'}
      className="ui-item"
      onClick={onOpen ? () => onOpen(feedback) : undefined}
      aria-label={onOpen ? `Avis ${feedback.note}/5${showAgency && feedback.agence_nom ? ` — ${feedback.agence_nom}` : ''}. Ouvrir le détail` : undefined}
    >
      <div className="ui-item__head">
        <Rating note={feedback.note} />
        {ia && <Badge value={ia.sentiment} label={SENTIMENT_LABEL[ia.sentiment]} />}
        {ia && (ia.criticite === 'critique' || ia.criticite === 'elevee') && (
          <Badge value={ia.criticite} label={`Gravité ${CRITICITE_LABEL[ia.criticite].toLowerCase()}`} />
        )}
        <span className="ui-item__spacer" />
        {statut && <Badge variant={STATUT_TONE[statut]} label={STATUT_LABEL[statut]} />}
      </div>

      <Heading className="ui-sr-only">Avis client</Heading>
      {feedback.commentaire ? (
        <p className="ui-item__text">{feedback.commentaire}</p>
      ) : (
        <p className="ui-item__text ui-item__text--empty">Note sans commentaire</p>
      )}

      <div className="ui-item__meta">
        {showAgency && feedback.agence_nom && (
          <>
            <span>{feedback.agence_nom}</span>
            <span className="ui-item__meta-sep" aria-hidden="true" />
          </>
        )}
        {ia?.theme_principal && (
          <>
            <span>{themeLabel(ia.theme_principal)}</span>
            <span className="ui-item__meta-sep" aria-hidden="true" />
          </>
        )}
        <time dateTime={feedback.date_soumission} title={fullDate(feedback.date_soumission)}>
          {relativeTime(feedback.date_soumission)}
        </time>
      </div>

      {actions && (
        <div className="ui-item__foot" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </Card>
  );
}
