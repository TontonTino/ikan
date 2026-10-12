import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ActiviteAgenceItem } from '../../types';
import { ActiviteListe } from './ActiviteAgence';
import { ACTIVITE_INITIALE, activiteReducer, type ActiviteState } from './activiteState';

const evenement = (id: string, auteur: string): ActiviteAgenceItem =>
  ({ id, auteur_nom: auteur, date: '2026-10-10T10:00:00Z', type_evenement: 'note_interne', details: `détail ${id}` } as ActiviteAgenceItem);

const rendu = (etat: ActiviteState) => renderToStaticMarkup(<ActiviteListe etat={etat} onRetry={vi.fn()} />);

describe('activité de l’agence — états affichés', () => {
  it('chargement : indicateur accessible, ni liste ni message vide', () => {
    const html = rendu(ACTIVITE_INITIALE);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Chargement de l&#x27;activité');
    expect(html).not.toContain('Aucun événement récent');
  });

  it('succès sans événement : véritable état vide', () => {
    const html = rendu({ statut: 'pret', evenements: [] });
    expect(html).toContain('Aucun événement récent');
    expect(html).not.toContain('Impossible de charger');
  });

  it('succès avec événements : ils sont affichés', () => {
    const html = rendu({ statut: 'pret', evenements: [evenement('a', 'Leila Mansour'), evenement('b', 'Sami Ben Ali')] });
    expect(html).toContain('Leila Mansour');
    expect(html).toContain('Sami Ben Ali');
    expect(html).not.toContain('Aucun événement récent');
  });

  it('erreur : message et réessai, JAMAIS « Aucun événement récent »', () => {
    const html = rendu({ statut: 'erreur', evenements: [] });
    expect(html).toContain('Impossible de charger l’activité de l’agence');
    expect(html).toContain('Réessayer');
    expect(html).not.toContain('Aucun événement récent');
  });

  it('erreur : aucun détail technique affiché', () => {
    expect(rendu({ statut: 'erreur', evenements: [] })).not.toMatch(/Error|500|Network|axios|undefined/);
  });

  it('échec d’actualisation avec données déjà chargées : les événements restent visibles', () => {
    const html = rendu({ statut: 'erreur', evenements: [evenement('a', 'Leila Mansour')] });
    expect(html).toContain('Leila Mansour');
    expect(html).toContain('Réessayer');
  });

  it('actualisation en cours avec données : la liste n’est pas remplacée par un squelette', () => {
    const html = rendu({ statut: 'chargement', evenements: [evenement('a', 'Leila Mansour')] });
    expect(html).toContain('Leila Mansour');
    expect(html).not.toContain('aria-busy="true"');
  });
});

describe('activité de l’agence — transitions', () => {
  it('démarre en chargement', () => {
    expect(ACTIVITE_INITIALE.statut).toBe('chargement');
  });

  it('succès sans événement = prêt et vide ; échec = erreur', () => {
    expect(activiteReducer(ACTIVITE_INITIALE, { type: 'succes', evenements: [] })).toEqual({ statut: 'pret', evenements: [] });
    expect(activiteReducer(ACTIVITE_INITIALE, { type: 'echec' }).statut).toBe('erreur');
  });

  it('nouvelle tentative : erreur, puis chargement, puis succès', () => {
    let etat = activiteReducer(ACTIVITE_INITIALE, { type: 'echec' });
    etat = activiteReducer(etat, { type: 'debut' });
    expect(etat.statut).toBe('chargement');
    etat = activiteReducer(etat, { type: 'succes', evenements: [evenement('a', 'Leila')] });
    expect(etat).toMatchObject({ statut: 'pret' });
    expect(etat.evenements).toHaveLength(1);
  });

  it('un échec n’efface pas les événements déjà chargés', () => {
    const charge = activiteReducer(ACTIVITE_INITIALE, { type: 'succes', evenements: [evenement('a', 'Leila'), evenement('b', 'Sami')] });
    const apres = activiteReducer(charge, { type: 'echec' });
    expect(apres.statut).toBe('erreur');
    expect(apres.evenements).toHaveLength(2);
  });
});
