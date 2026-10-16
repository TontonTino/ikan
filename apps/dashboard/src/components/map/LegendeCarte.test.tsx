import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { STATUT_SEUIL_LABEL, statutSeuil, type StatutSeuil } from '../../pages/cx/siege/siegeData';
import {
  LegendeCarte, ListeAgencesCarte, ORDRE_LEGENDE, PHRASE_SEUIL_PAR_AGENCE, STATUT_COULEUR, STATUT_EXPLICATION, STATUT_SYMBOLE,
} from './LegendeCarte';

// React échappe l'apostrophe droite en HTML : on compare au texte tel qu'il est rendu.
const html_ = (texte: string) => texte.replace(/'/g, '&#x27;');

describe('légende de la carte (CX-02)', () => {
  it('une phrase dit que les couleurs suivent le seuil de chaque agence', () => {
    expect(PHRASE_SEUIL_PAR_AGENCE).toBe('Les couleurs tiennent compte du seuil de chaque agence.');
    expect(renderToStaticMarkup(<LegendeCarte />)).toContain('Les couleurs tiennent compte du seuil de chaque agence.');
  });

  it('chaque statut a un libellé, une explication et un symbole dans la légende', () => {
    const html = renderToStaticMarkup(<LegendeCarte />);
    expect(ORDRE_LEGENDE).toEqual(['au_dessus', 'sous', 'pas_assez_avis', 'sans_avis']);
    for (const statut of ORDRE_LEGENDE) {
      expect(html).toContain(html_(STATUT_SEUIL_LABEL[statut]));
      expect(html).toContain(html_(STATUT_EXPLICATION[statut]));
      expect(html).toContain(`${STATUT_SYMBOLE[statut]} `);
    }
    expect(html).toContain('Au-dessus du seuil');
    expect(html).toContain('Sous le seuil');
    expect(html).toContain('Moins de 3 avis');
    expect(html).toContain("Pas d&#x27;avis");
  });

  it('les symboles sont tous différents : les statuts se distinguent sans la couleur', () => {
    expect(new Set(Object.values(STATUT_SYMBOLE)).size).toBe(4);
  });

  it('les couleurs et les règles de calcul ne changent pas', () => {
    expect(STATUT_COULEUR).toEqual({ au_dessus: '#3C7730', sous: '#DC2626', pas_assez_avis: '#64748B', sans_avis: '#94A3B8' });
    const attendu: Array<[number | null, number, number | null, StatutSeuil]> = [
      [85, 10, 80, 'au_dessus'], [80, 10, 80, 'au_dessus'], [79.9, 10, 80, 'sous'], [50, 2, 80, 'pas_assez_avis'], [null, 0, 80, 'sans_avis'], [50, 10, null, 'pas_assez_avis'],
    ];
    for (const [satisfaction, avis, seuil, statut] of attendu) expect(statutSeuil(satisfaction, avis, seuil)).toBe(statut);
  });
});

describe('liste des agences de la carte', () => {
  it('donne le statut de chaque agence en toutes lettres, sans dépendre de la couleur', () => {
    const html = renderToStaticMarkup(
      <ListeAgencesCarte
        agences={[
          { id: 'a', nom: 'Alpha', ville: 'Lyon', satisfaction: 90, avis: 12, seuil: 80, statut: 'au_dessus' },
          { id: 'b', nom: 'Beta', ville: null, satisfaction: 60, avis: 9, seuil: 80, statut: 'sous' },
          { id: 'c', nom: 'Gamma', ville: null, satisfaction: 100, avis: 2, seuil: 80, statut: 'pas_assez_avis' },
          { id: 'd', nom: 'Delta', ville: null, satisfaction: null, avis: 0, seuil: 80, statut: 'sans_avis' },
        ]}
      />,
    );
    expect(html).toContain('<strong>Alpha</strong> (Lyon) — Au-dessus du seuil : 90 %, seuil 80 %');
    expect(html).toContain('<strong>Beta</strong> — Sous le seuil : 60 %, seuil 80 %');
    expect(html).toContain('<strong>Gamma</strong> — Moins de 3 avis');
    expect(html).toContain('<strong>Delta</strong> — Pas d&#x27;avis');
  });
});
