import React from 'react';
import type { VeilleThemeBucket } from '../../types';
import { themeLabel } from '../../utils/themeLabels';
import { formaterNombre, formaterPourcentage } from '../../utils/formatNombre';

const MAX_THEMES = 6;

/**
 * Thèmes classés du plus au moins cité : une barre horizontale d'une seule couleur (la longueur porte l'information,
 * pas la teinte). « Non classé » ferme toujours la liste, en retrait. Remplace le camembert, illisible au-delà de 4 parts.
 */
export default function VeilleThemes({ data, onChoisir, actif }: { data: VeilleThemeBucket[]; onChoisir?: (theme: string) => void; actif?: string }) {
  const classes = data.filter((t) => t.theme_principal).sort((a, b) => b.count - a.count);
  const visibles = classes.slice(0, MAX_THEMES);
  const autres = classes.slice(MAX_THEMES);
  const nonClasse = data.find((t) => !t.theme_principal);
  const max = Math.max(1, ...data.map((t) => t.count));

  const lignes = [
    ...visibles.map((t) => ({ cle: t.theme_principal!, libelle: themeLabel(t.theme_principal), count: t.count, pourcentage: t.pourcentage, discret: false })),
    ...(autres.length
      ? [{ cle: '', libelle: `${autres.length} autre${autres.length > 1 ? 's' : ''} thème${autres.length > 1 ? 's' : ''}`, count: autres.reduce((s, t) => s + t.count, 0), pourcentage: autres.reduce((s, t) => s + t.pourcentage, 0), discret: true }]
      : []),
    ...(nonClasse && nonClasse.count > 0 ? [{ cle: 'non_classe', libelle: 'Non classé', count: nonClasse.count, pourcentage: nonClasse.pourcentage, discret: true }] : []),
  ];

  if (lignes.length === 0) return <p className="veille-vide-court">Aucun thème sur la période.</p>;

  return (
    <ol className="veille-themes">
      {lignes.map((l) => {
        const contenu = (
          <>
            <span className="veille-themes__ligne">
              <span className="veille-themes__libelle">{l.libelle}</span>
              <span className="veille-themes__chiffres">
                <strong>{formaterNombre(l.count, 0)}</strong> · {formaterPourcentage(l.pourcentage, 0)}
              </span>
            </span>
            <span className="veille-themes__piste" aria-hidden="true">
              <span className="veille-themes__barre" style={{ width: `${(l.count / max) * 100}%` }} />
            </span>
          </>
        );
        const classe = `veille-themes__item${l.discret ? ' veille-themes__item--discret' : ''}${actif && actif === l.cle ? ' veille-themes__item--actif' : ''}`;
        return (
          <li key={l.cle || 'autres'} className={classe}>
            {onChoisir && l.cle ? (
              <button type="button" className="veille-themes__bouton" aria-pressed={actif === l.cle} onClick={() => onChoisir(actif === l.cle ? '' : l.cle)} title={actif === l.cle ? 'Retirer ce filtre' : 'Voir les mentions de ce thème'}>
                {contenu}
              </button>
            ) : (
              <span className="veille-themes__bouton veille-themes__bouton--fixe">{contenu}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
