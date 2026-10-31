import React from 'react';
import type { Feedback, StatutTraitement, CriticiteType } from '../../types';
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon, ThumbsUpIcon, ThumbsDownIcon } from '../common/Icons';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS } from '../../utils/vocabulaire';
import { normalizeCriticite, normalizeSentiment } from '../../utils/triageAvis';
import BadgeDiscordance from './BadgeDiscordance';

export const STATUT_BADGES: Record<StatutTraitement, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  nouveau: { label: AVIS_STATUT_LABELS.nouveau, bg: '#FEE2E2', text: '#B91C1C', icon: <AlertTriangleIcon size={12} color="#DC2626" /> },
  en_traitement: { label: AVIS_STATUT_LABELS.en_traitement, bg: '#E0F2FE', text: '#0369A1', icon: <ClockIcon size={12} color="#0369A1" /> },
  en_cours: { label: AVIS_STATUT_LABELS.en_cours, bg: '#FEF3C7', text: '#92400E', icon: <ClockIcon size={12} color="#D97706" /> },
  resolu: { label: AVIS_STATUT_LABELS.resolu, bg: '#EBF5E9', text: '#3C7730', icon: <CheckCircleIcon size={12} color="#3C7730" /> },
};

export const SENTIMENT_STYLE: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  positif: { bg: '#EBF5E9', text: '#3C7730', label: 'Positif', icon: <ThumbsUpIcon size={13} color="#3C7730" /> },
  neutre: { bg: '#FEF3C7', text: '#B45309', label: 'Neutre', icon: <span style={{ fontSize: '0.85rem' }} aria-hidden="true">😐</span> },
  negatif: { bg: '#FEE2E2', text: '#B91C1C', label: 'Négatif', icon: <ThumbsDownIcon size={13} color="#B91C1C" /> },
};

export const CRITICITE_STYLE: Record<string, { bg: string; text: string }> = {
  faible: { bg: '#F1F5F9', text: '#475569' },
  moyenne: { bg: '#E0F2FE', text: '#0369A1' },
  elevee: { bg: '#FFEDD5', text: '#C2410C' },
  critique: { bg: '#FEE2E2', text: '#B91C1C' },
};

export const formatDateAvis = (dateStr?: string) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
};

/** Libellé d'un avis sans analyse : neutre, jamais un vide. « Analyse indisponible » quand les reprises automatiques ont échoué (IA-01). */
export const libelleAnalyseAbsente = (feedback: Pick<Feedback, 'analyse_statut'>) =>
  feedback.analyse_statut === 'indisponible' ? 'Analyse indisponible' : 'Non analysé';

const libelleGravite = (criticite: string) => (GRAVITE_LABELS[criticite as CriticiteType] ?? criticite).toLowerCase();

/** Pastille de gravité du tableau : toujours un texte (« CRITIQUE », « ÉLEVÉE », « Gravité faible »…). */
export function PastilleGravite({ feedback }: { feedback: Feedback }) {
  const criticite = feedback.analyse_ia?.criticite;
  if (!criticite) return <span style={{ fontSize: '0.70rem', color: '#64748B' }}>{feedback.analyse_ia ? 'Gravité non évaluée' : libelleAnalyseAbsente(feedback)}</span>;
  const fort = criticite === 'critique' || criticite === 'elevee';
  return (
    <span
      aria-label={`Gravité ${libelleGravite(criticite)}`}
      style={{
        background: CRITICITE_STYLE[criticite]?.bg || '#F1F5F9',
        color: CRITICITE_STYLE[criticite]?.text || '#475569',
        padding: fort ? '3px 8px' : '1px 0',
        borderRadius: '6px',
        fontSize: fort ? '0.72rem' : '0.70rem',
        fontWeight: 800,
        border: criticite === 'critique' ? '1px solid #DC2626' : '1px solid transparent',
      }}
    >
      {criticite === 'critique' ? 'CRITIQUE' : criticite === 'elevee' ? 'ÉLEVÉE' : `Gravité ${libelleGravite(criticite)}`}
    </span>
  );
}

/** Note, ton, gravité et discordance d'un avis (cellule du tableau). */
export function SignauxAvis({ feedback }: { feedback: Feedback }) {
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  const meta = SENTIMENT_STYLE[sentiment] || { bg: '#F1F5F9', text: '#64748B', label: sentiment || '—', icon: null };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, color: '#0F172A', fontSize: '0.90rem' }}>★ {feedback.note}/5</span>
        <span style={{ background: meta.bg, color: meta.text, padding: '2px 8px', borderRadius: '6px', fontSize: '0.70rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          {meta.icon}
          {feedback.analyse_ia ? meta.label : libelleAnalyseAbsente(feedback)}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '7px' }}>
        <PastilleGravite feedback={feedback} />
        <BadgeDiscordance discordance={feedback.analyse_ia?.discordance_detectee} />
      </div>
    </>
  );
}

/** Carte d'un avis pour petit écran (≤ 700 px) : mêmes informations que la ligne du tableau, discordance comprise. */
export function AvisCarteMobile({ feedback, afficherAgence, onConsulter }: { feedback: Feedback; afficherAgence: boolean; onConsulter: () => void }) {
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  const sentimentMeta = SENTIMENT_STYLE[sentiment];
  const criticite = normalizeCriticite(feedback.analyse_ia?.criticite);
  const statut = STATUT_BADGES[(feedback.statut_traitement || 'nouveau') as StatutTraitement] || STATUT_BADGES.nouveau;
  const libelleCriticite = feedback.analyse_ia
    ? (CRITICITE_STYLE[criticite] ? `${criticite === 'elevee' ? 'Élevée' : criticite.charAt(0).toUpperCase() + criticite.slice(1)}` : 'Gravité non évaluée')
    : libelleAnalyseAbsente(feedback);
  return (
    <article className="feedbacks-mobile-card">
      <div className="feedbacks-mobile-card-top">
        <strong>★ {feedback.note}/5</strong>
        <span>{libelleCriticite}</span>
        <span>{sentimentMeta?.label || (feedback.analyse_ia ? 'Ton non évalué' : libelleAnalyseAbsente(feedback))}</span>
        <BadgeDiscordance discordance={feedback.analyse_ia?.discordance_detectee} />
      </div>
      <p>{feedback.commentaire || 'Pas de commentaire écrit.'}</p>
      <div className="feedbacks-mobile-meta">
        {afficherAgence && <span>{feedback.agence_nom || 'Agence'}</span>}
        <time dateTime={feedback.date_soumission}>{formatDateAvis(feedback.date_soumission)}</time>
        <span className="feedbacks-mobile-status" style={{ background: statut.bg, color: statut.text }}>{statut.label}</span>
        {feedback.issue_id && <span>Rattaché à un problème</span>}
      </div>
      <button type="button" className="btn-primary" onClick={onConsulter}>Consulter</button>
    </article>
  );
}
