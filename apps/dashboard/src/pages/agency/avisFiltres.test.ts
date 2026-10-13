import { describe, expect, it } from 'vitest';
import {
  FILTRES_INITIAUX, LONGUEUR_MAX_RECHERCHE, TAILLE_PAGE, filtresActifs, libelleTotal, nombrePages, parametresApi, reduireFiltres,
  type FiltresAvis,
} from './avisFiltres';

const page3: FiltresAvis = { ...FILTRES_INITIAUX, page: 3 };

describe('retour à la page 1 quand un filtre change', () => {
  it.each(['sentiment', 'theme', 'periode', 'note', 'criticite', 'recherche', 'onglet', 'agenceId'] as const)('%s', (champ) => {
    const apres = reduireFiltres(page3, { type: 'definir', champ, valeur: 'positif' });
    expect(apres[champ]).toBe('positif');
    expect(apres.page).toBe(0);
  });

  it('changer de page ne touche pas aux filtres', () => {
    const filtres = { ...FILTRES_INITIAUX, sentiment: 'negatif', recherche: 'remboursement' };
    const apres = reduireFiltres(filtres, { type: 'page', page: 2 });
    expect(apres).toEqual({ ...filtres, page: 2 });
    expect(reduireFiltres(apres, { type: 'page', page: -4 }).page).toBe(0);
  });

  it('une valeur identique ne renvoie pas à la page 1 (la recherche différée rejoue la même valeur)', () => {
    const filtres = { ...FILTRES_INITIAUX, recherche: 'abc', page: 2 };
    expect(reduireFiltres(filtres, { type: 'definir', champ: 'recherche', valeur: 'abc' })).toBe(filtres);
  });

  it('réinitialiser garde l’agence imposée par la page et revient à la page 1', () => {
    const filtres = { ...page3, sentiment: 'negatif', recherche: 'x', onglet: 'a_traiter' as const, agenceId: 'A1' };
    expect(reduireFiltres(filtres, { type: 'reinitialiser', agenceId: 'A1' })).toEqual({ ...FILTRES_INITIAUX, agenceId: 'A1' });
    expect(reduireFiltres(filtres, { type: 'reinitialiser' })).toEqual(FILTRES_INITIAUX);
  });
});

describe('paramètres envoyés au serveur', () => {
  it('sans filtre : seulement la pagination', () => {
    expect(parametresApi(FILTRES_INITIAUX)).toEqual({ limit: TAILLE_PAGE, offset: 0 });
  });

  it('chaque filtre est envoyé au serveur, rien n’est filtré localement', () => {
    const p = parametresApi({ ...FILTRES_INITIAUX, sentiment: 'negatif', theme: 'attente', note: '2', criticite: 'elevee', recherche: '  100% ', page: 2 });
    expect(p).toEqual({ limit: TAILLE_PAGE, offset: 2 * TAILLE_PAGE, theme: 'attente', sentiment: 'negatif', criticite: 'elevee', note: 2, q: '100%' });
  });

  it('la recherche est nettoyée et plafonnée ; vide = absente', () => {
    expect(parametresApi({ ...FILTRES_INITIAUX, recherche: '    ' })).not.toHaveProperty('q');
    expect(parametresApi({ ...FILTRES_INITIAUX, recherche: 'x'.repeat(500) }).q).toHaveLength(LONGUEUR_MAX_RECHERCHE);
  });

  it('les onglets deviennent des filtres serveur', () => {
    expect(parametresApi({ ...FILTRES_INITIAUX, onglet: 'a_traiter' })).toMatchObject({ a_traiter: true });
    expect(parametresApi({ ...FILTRES_INITIAUX, onglet: 'critiques' })).toMatchObject({ a_surveiller: true });
    expect(parametresApi({ ...FILTRES_INITIAUX, onglet: 'tous' })).not.toHaveProperty('a_traiter');
  });

  it('un compteur d’onglet ignore l’onglet affiché et la page', () => {
    const f = { ...FILTRES_INITIAUX, onglet: 'critiques' as const, page: 4, sentiment: 'negatif' };
    expect(parametresApi(f, { onglet: 'a_traiter', limit: 1, offset: 0 })).toEqual({ limit: 1, offset: 0, sentiment: 'negatif', a_traiter: true });
  });

  it('l’agence imposée par la page l’emporte sur le sélecteur', () => {
    expect(parametresApi({ ...FILTRES_INITIAUX, agenceId: 'AUTRE' }, { agenceFixe: 'MIENNE' }).agence_id).toBe('MIENNE');
    expect(parametresApi({ ...FILTRES_INITIAUX, agenceId: 'X' }).agence_id).toBe('X');
  });

  it('la période « 7 jours » commence 6 jours avant aujourd’hui, à minuit', () => {
    const maintenant = new Date(2026, 9, 13, 15, 30);
    const debut = parametresApi({ ...FILTRES_INITIAUX, periode: '7' }, { maintenant }).date_debut as string;
    expect(new Date(debut)).toEqual(new Date(2026, 9, 7, 0, 0));
  });
});

describe('total et filtres actifs', () => {
  it('« N avis », pages calculées sur le total serveur', () => {
    expect(libelleTotal(0)).toBe('0 avis');
    expect(libelleTotal(142)).toBe('142 avis');
    expect([nombrePages(0), nombrePages(25), nombrePages(26), nombrePages(142)]).toEqual([1, 1, 2, 6]);
  });

  it('filtres actifs lisibles et ciblés (l’agence imposée n’est pas listée)', () => {
    const aide = { libelleTheme: (t: string) => `Thème ${t}`, nomAgence: () => 'Lyon' };
    const f = { ...FILTRES_INITIAUX, agenceId: 'A', sentiment: 'negatif', periode: '30', recherche: 'retard' };
    expect(filtresActifs(f, aide).map((x) => x.libelle)).toEqual(['Agence : Lyon', 'Ton : Négatif', 'Période : 30 derniers jours', 'Recherche : « retard »']);
    expect(filtresActifs(f, { ...aide, agenceFixe: true }).map((x) => x.cle)).not.toContain('agenceId');
    expect(filtresActifs(FILTRES_INITIAUX, aide)).toEqual([]);
  });
});
