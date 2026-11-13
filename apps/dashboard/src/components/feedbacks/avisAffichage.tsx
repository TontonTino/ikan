import React from 'react';
import type { Feedback, StatutTraitement, CriticiteType } from '../../types';
import { CheckCircleIcon, ClockIcon, MessageSquareIcon, SmileyMehIcon, ThumbsUpIcon, ThumbsDownIcon } from '../common/Icons';
import { AVIS_STATUT_LABELS, GRAVITE_LABELS } from '../../utils/vocabulaire';
import { normalizeCriticite, normalizeSentiment } from '../../utils/triageAvis';
import BadgeDiscordance from './BadgeDiscordance';
import { dateRelativeOuAbsolue, fullDate } from '../ui/format';

export const STATUT_BADGES: Record<StatutTraitement, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  nouveau: { label: AVIS_STATUT_LABELS.nouveau, bg: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)', icon: <MessageSquareIcon size={12} color="var(--color-neutre-texte)" /> },
  en_traitement: { label: AVIS_STATUT_LABELS.en_traitement, bg: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)', icon: <ClockIcon size={12} color="var(--color-neutre-texte)" /> },
  en_cours: { label: AVIS_STATUT_LABELS.en_cours, bg: 'var(--color-surveiller-fond)', text: 'var(--color-surveiller-texte)', icon: <ClockIcon size={12} color="var(--color-surveiller-texte)" /> },
  resolu: { label: AVIS_STATUT_LABELS.resolu, bg: 'var(--color-bon-fond)', text: 'var(--color-bon-texte)', icon: <CheckCircleIcon size={12} color="var(--color-bon-texte)" /> },
};

export const SENTIMENT_STYLE: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
  positif: { bg: 'var(--color-bon-fond)', text: 'var(--color-bon-texte)', label: 'Positif', icon: <ThumbsUpIcon size={13} color="var(--color-bon-texte)" /> },
  neutre: { bg: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)', label: 'Neutre', icon: <SmileyMehIcon size={13} color="var(--color-neutre-texte)" /> },
  negatif: { bg: 'var(--color-critique-fond)', text: 'var(--color-critique-texte)', label: 'Négatif', icon: <ThumbsDownIcon size={13} color="var(--color-critique-texte)" /> },
};

export const CRITICITE_STYLE: Record<string, { bg: string; text: string }> = {
  faible: { bg: 'var(--color-neutre-fond)', text: 'var(--color-text-2)' },
  moyenne: { bg: 'var(--color-neutre-fond)', text: 'var(--color-neutre-texte)' },
  elevee: { bg: 'var(--color-surveiller-fond)', text: 'var(--color-surveiller-texte)' },
  critique: { bg: 'var(--color-critique-fond)', text: 'var(--color-critique-texte)' },
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

const libelleGravite = (criticite: string) => (GRAVITE_LABELS[criticite as CriticiteType] ?? 'non évaluée').toLowerCase();

/** Pastille d'urgence du tableau : toujours un texte (« CRITIQUE », « ÉLEVÉE », « Urgence normale »). */
export function PastilleGravite({ feedback }: { feedback: Feedback }) {
  const criticite = feedback.analyse_ia?.criticite;
  if (!criticite) return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>{feedback.analyse_ia ? 'Urgence non évaluée' : libelleAnalyseAbsente(feedback)}</span>;
  const fort = criticite === 'critique' || criticite === 'elevee';
  return (
    <span
      aria-label={`Urgence ${libelleGravite(criticite)}`}
      style={{
        background: CRITICITE_STYLE[criticite]?.bg || 'var(--color-neutre-fond)',
        color: CRITICITE_STYLE[criticite]?.text || 'var(--color-text-2)',
        padding: fort ? '3px 8px' : '1px 0',
        borderRadius: '6px',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
      }}
    >
      {criticite === 'critique' ? 'CRITIQUE' : criticite === 'elevee' ? 'ÉLEVÉE' : `Urgence ${libelleGravite(criticite)}`}
    </span>
  );
}

/** Note, ton, gravité et discordance d'un avis (cellule du tableau). */
export function SignauxAvis({ feedback }: { feedback: Feedback }) {
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  const meta = SENTIMENT_STYLE[sentiment] || { bg: 'var(--color-neutre-fond)', text: 'var(--color-text-2)', label: sentiment || '—', icon: null };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', fontSize: 'var(--text-sm)' }}>★ {feedback.note}/5</span>
        <span style={{ background: meta.bg, color: meta.text, padding: '2px 8px', borderRadius: '6px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
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

/** Note, ton, gravité forte et discordance sur une seule ligne (liste dense de la page Avis). La gravité faible ou moyenne
 *  n'est pas répétée à chaque ligne : elle reste dans la fenêtre de l'avis et dans les filtres. */
export function SignauxAvisCompacts({ feedback }: { feedback: Feedback }) {
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  const meta = SENTIMENT_STYLE[sentiment] || { bg: 'var(--color-neutre-fond)', text: 'var(--color-text-2)', label: sentiment || '—', icon: null };
  const criticite = feedback.analyse_ia?.criticite;
  const fort = criticite === 'critique' || criticite === 'elevee';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap' }}>
      <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>★ {feedback.note}/5</span>
      <span style={{ background: meta.bg, color: meta.text, padding: '2px 8px', borderRadius: '6px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', display: 'inline-flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
        {meta.icon}
        {feedback.analyse_ia ? meta.label : libelleAnalyseAbsente(feedback)}
      </span>
      {fort && <PastilleGravite feedback={feedback} />}
      <BadgeDiscordance discordance={feedback.analyse_ia?.discordance_detectee} />
    </div>
  );
}

/** Date d'un avis selon la convention du dashboard : relative jusqu'à 30 jours, puis « 12 oct. 2026 » ; date complète au survol. */
export function DateAvis({ iso }: { iso: string }) {
  return <time dateTime={iso} title={fullDate(iso)}>{dateRelativeOuAbsolue(iso)}</time>;
}

/** Carte d'un avis pour petit écran (≤ 700 px) : mêmes informations que la ligne du tableau, discordance comprise. */
export function AvisCarteMobile({ feedback, afficherAgence, enRetard = false, onConsulter }: { feedback: Feedback; afficherAgence: boolean; enRetard?: boolean; onConsulter: () => void }) {
  const sentiment = normalizeSentiment(feedback.analyse_ia?.sentiment);
  const sentimentMeta = SENTIMENT_STYLE[sentiment];
  const criticite = normalizeCriticite(feedback.analyse_ia?.criticite);
  const statut = STATUT_BADGES[(feedback.statut_traitement || 'nouveau') as StatutTraitement] || STATUT_BADGES.nouveau;
  const libelleCriticite = feedback.analyse_ia
    ? (CRITICITE_STYLE[criticite] ? GRAVITE_LABELS[criticite as CriticiteType] ?? 'Urgence non évaluée' : 'Urgence non évaluée')
    : libelleAnalyseAbsente(feedback);
  return (
    <article className={`feedbacks-mobile-card${enRetard ? ' is-late' : ''}`}>
      {enRetard && <span className="ui-sr-only">Sans prise en charge depuis plus de 48 h.</span>}
      <div className="feedbacks-mobile-card-top">
        <strong>★ {feedback.note}/5</strong>
        <span>{libelleCriticite}</span>
        <span>{sentimentMeta?.label || (feedback.analyse_ia ? 'Ton non évalué' : libelleAnalyseAbsente(feedback))}</span>
        <BadgeDiscordance discordance={feedback.analyse_ia?.discordance_detectee} />
      </div>
      <p>{feedback.commentaire || 'Pas de commentaire écrit.'}</p>
      <div className="feedbacks-mobile-meta">
        {afficherAgence && <span>{feedback.agence_nom || 'Agence'}</span>}
        <DateAvis iso={feedback.date_soumission} />
        <span className="feedbacks-mobile-status" style={{ background: statut.bg, color: statut.text }}>{statut.label}</span>
        {feedback.issue_id && <span>Rattaché à un problème</span>}
      </div>
      <button type="button" className="btn-secondary" onClick={onConsulter}>Consulter</button>
    </article>
  );
}
