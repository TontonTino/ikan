import { describe, expect, it } from 'vitest';
import { FILTRES_INITIAUX, TAILLE_PAGE, filtresActifs, parametresApi, reduireFiltres } from './avisFiltres';

const aide = { libelleTheme: (t: string) => t };

describe('filtre « avis contradictoires » (CX-04)', () => {
  it('par défaut : pas de filtre, aucun paramètre envoyé (comportement inchangé)', () => {
    expect(FILTRES_INITIAUX.discordance).toBe('all');
    expect(parametresApi(FILTRES_INITIAUX)).toEqual({ limit: TAILLE_PAGE, offset: 0 });
    expect(filtresActifs(FILTRES_INITIAUX, aide)).toEqual([]);
  });

  it('activé : envoyé au serveur (discordance=true) et combiné avec les autres filtres', () => {
    const f = { ...FILTRES_INITIAUX, discordance: 'oui', agenceId: 'A1', note: '5' };
    expect(parametresApi(f)).toEqual({ limit: TAILLE_PAGE, offset: 0, agence_id: 'A1', note: 5, discordance: true });
  });

  it('un compteur d’onglet garde le filtre (les totaux portent sur les avis filtrés)', () => {
    expect(parametresApi({ ...FILTRES_INITIAUX, discordance: 'oui' }, { onglet: 'a_traiter', limit: 1, offset: 0 }))
      .toEqual({ limit: 1, offset: 0, discordance: true, a_traiter: true });
  });

  it('affiché comme filtre actif lisible, supprimable en revenant à « all »', () => {
    const actifs = filtresActifs({ ...FILTRES_INITIAUX, discordance: 'oui' }, aide);
    expect(actifs).toEqual([{ cle: 'discordance', libelle: 'Avis contradictoires' }]);
    const apres = reduireFiltres({ ...FILTRES_INITIAUX, discordance: 'oui', page: 3 }, { type: 'definir', champ: 'discordance', valeur: 'all' });
    expect(apres.discordance).toBe('all');
    expect(apres.page).toBe(0);
  });

  it('changer le filtre revient à la page 1 ; réinitialiser le remet à « all »', () => {
    expect(reduireFiltres({ ...FILTRES_INITIAUX, page: 4 }, { type: 'definir', champ: 'discordance', valeur: 'oui' })).toMatchObject({ discordance: 'oui', page: 0 });
    expect(reduireFiltres({ ...FILTRES_INITIAUX, discordance: 'oui' }, { type: 'reinitialiser' }).discordance).toBe('all');
  });
});
