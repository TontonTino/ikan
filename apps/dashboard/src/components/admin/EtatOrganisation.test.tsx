import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BadgeEtatOrganisation, TEXTE_CONFIRMATION_DESACTIVATION, TEXTE_REACTIVATION_POSSIBLE, libelleEtatOrganisation } from './EtatOrganisation';

describe('état d’une organisation (AD-01)', () => {
  it('le badge dit « Désactivée » ou « Active » en toutes lettres (la couleur n’est pas le seul signal)', () => {
    expect(renderToStaticMarkup(<BadgeEtatOrganisation active={false} />)).toContain('Désactivée');
    expect(renderToStaticMarkup(<BadgeEtatOrganisation active />)).toContain('Active');
    expect(libelleEtatOrganisation(false)).toBe('Désactivée');
  });

  it('la confirmation annonce les conséquences exactes', () => {
    expect(TEXTE_CONFIRMATION_DESACTIVATION).toBe('Les comptes de cette organisation ne pourront plus se connecter. Les données sont conservées.');
    expect(TEXTE_REACTIVATION_POSSIBLE).toContain('réactiver');
  });
});
