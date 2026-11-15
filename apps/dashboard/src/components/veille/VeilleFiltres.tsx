import React from 'react';
import type { SentimentType, VeilleThemeBucket } from '../../types';
import { SearchIcon, XCloseIcon } from '../common/Icons';
import { themeLabel } from '../../utils/themeLabels';
import { TONS } from './VeilleSynthese';

interface Props {
  sentiment: SentimentType | null;
  onSentiment: (v: SentimentType | null) => void;
  theme: string;
  onTheme: (v: string) => void;
  recherche: string;
  onRecherche: (v: string) => void;
  themes: VeilleThemeBucket[];
}

/**
 * Filtres de la LISTE des mentions, posés au-dessus d'elle (et non en haut de page) : ils n'agissent que sur la liste,
 * pas sur la synthèse. Le filtre actif se lit sans la couleur (fond plein + aria-pressed).
 */
export default function VeilleFiltres({ sentiment, onSentiment, theme, onTheme, recherche, onRecherche, themes }: Props) {
  const actifs = sentiment !== null || theme !== '' || recherche.trim() !== '';
  const options = themes.filter((t) => t.theme_principal).sort((a, b) => b.count - a.count);

  return (
    <div className="veille-filtres">
      <div className="veille-segment" role="group" aria-label="Filtrer les mentions par ton">
        {[{ cle: null, libelle: 'Tous' } as { cle: SentimentType | null; libelle: string }, ...TONS].map((o) => (
          <button key={o.libelle} type="button" aria-pressed={sentiment === o.cle} className="veille-segment__option" onClick={() => onSentiment(o.cle)}>
            {o.libelle}
          </button>
        ))}
      </div>

      <select className="veille-champ veille-champ--select" aria-label="Filtrer les mentions par thème" value={theme} onChange={(e) => onTheme(e.target.value)}>
        <option value="">Tous les thèmes</option>
        {options.map((t) => (
          <option key={t.theme_principal} value={t.theme_principal!}>{themeLabel(t.theme_principal)}</option>
        ))}
        <option value="non_classe">Non classé</option>
      </select>

      <label className="veille-champ veille-recherche">
        <SearchIcon size={16} aria-hidden="true" />
        <input type="search" aria-label="Rechercher dans les mentions" placeholder="Rechercher un mot…" value={recherche} onChange={(e) => onRecherche(e.target.value)} />
      </label>

      {actifs && (
        <button type="button" className="veille-lien veille-filtres__effacer" onClick={() => { onSentiment(null); onTheme(''); onRecherche(''); }}>
          <XCloseIcon size={14} aria-hidden="true" /> Effacer les filtres
        </button>
      )}
    </div>
  );
}
