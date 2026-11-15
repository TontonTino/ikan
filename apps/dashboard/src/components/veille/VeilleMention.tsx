import React, { useState } from 'react';
import { ThumbsUpIcon, ThumbsDownIcon, SmileyMehIcon, ExternalLinkIcon, StoreIcon, FacebookIcon } from '../common/Icons';
import type { VeilleMention as Mention } from '../../types';
import { themeLabel } from '../../utils/themeLabels';
import { jourComplet, jourRelatifOuAbsolu } from '../../utils/dateJour';

const TON: Record<string, { libelle: string; classe: string; icone: React.ReactNode }> = {
  positif: { libelle: 'Positif', classe: 'badge-success', icone: <ThumbsUpIcon size={12} /> },
  neutre: { libelle: 'Neutre', classe: 'badge-neutral', icone: <SmileyMehIcon size={12} /> },
  negatif: { libelle: 'Négatif', classe: 'badge-error', icone: <ThumbsDownIcon size={12} /> },
};

const PLATEFORMES: Record<string, string> = { facebook: 'Facebook', google_reviews: 'Avis Google' };

/** Au-delà, le texte est replié sur 3 lignes avec « Lire la suite ». */
export const TEXTE_LONG = 220;

// N'affiche « Voir sur Facebook » que si l'API a conservé un lien : elle ne garde que le permalink
// https réel (facebook.com / fb.com) et met null sinon. Garde https par défense en profondeur.
export function estUrlSure(url: string | null): url is string {
  return !!url && url.startsWith('https://');
}

/**
 * Une mention = une ligne d'une liste continue (pas une carte par mention) : le ton d'abord (badge avec icône + libellé),
 * puis le texte, puis une ligne de métadonnées discrète. La date suit la convention du dashboard (relative jusqu'à 30 jours,
 * complète au survol).
 */
export default function VeilleMention({ mention }: { mention: Mention }) {
  const [deplie, setDeplie] = useState(false);
  const ton = TON[mention.sentiment] ?? TON.neutre;
  const long = mention.texte.length > TEXTE_LONG;
  const plateforme = PLATEFORMES[mention.plateforme] ?? mention.plateforme;
  const date = mention.date_publication ? jourRelatifOuAbsolu(mention.date_publication) : '';

  return (
    <li className="veille-mention">
      <span className={`badge ${ton.classe} veille-mention__ton`}>
        {ton.icone}
        {ton.libelle}
      </span>
      <div className="veille-mention__corps">
        <p className={`veille-mention__texte${long && !deplie ? ' veille-mention__texte--replie' : ''}`}>{mention.texte}</p>
        {long && (
          <button type="button" className="veille-lien" aria-expanded={deplie} onClick={() => setDeplie((d) => !d)}>
            {deplie ? 'Réduire' : 'Lire la suite'}
          </button>
        )}
        <p className="veille-mention__meta">
          {date ? (
            <time dateTime={mention.date_publication!} title={jourComplet(mention.date_publication!)}>{date}</time>
          ) : (
            <span>Date inconnue</span>
          )}
          <span className="veille-mention__source">
            {mention.plateforme === 'facebook' && <FacebookIcon size={13} aria-hidden="true" />}
            {plateforme}
          </span>
          {mention.agence_nom && (
            <span className="veille-mention__source">
              <StoreIcon size={13} aria-hidden="true" />
              {mention.agence_nom}
            </span>
          )}
          <span
            className="veille-mention__theme"
            title={mention.theme_confidence == null ? undefined : `Thème attribué automatiquement — confiance ${Math.round(mention.theme_confidence * 100)} %`}
          >
            {themeLabel(mention.theme_principal)}
          </span>
          {estUrlSure(mention.url_source) && (
            <a className="veille-lien veille-mention__lien" href={mention.url_source} target="_blank" rel="noopener noreferrer">
              Voir sur {plateforme}
              <ExternalLinkIcon size={12} aria-hidden="true" />
              <span className="ui-sr-only"> (nouvel onglet)</span>
            </a>
          )}
        </p>
      </div>
    </li>
  );
}
