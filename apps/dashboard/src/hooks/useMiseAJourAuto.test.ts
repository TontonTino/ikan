import { describe, expect, it, vi } from 'vitest';
import { DELAI_RETOUR_ONGLET_MS, programmerMiseAJour, type Environnement } from './useMiseAJourAuto';

function faux() {
  const etat = { visible: true, enLigne: true, t: 0, tic: null as null | (() => void), retour: null as null | (() => void), arrete: false };
  const env: Environnement = {
    visible: () => etat.visible,
    enLigne: () => etat.enLigne,
    maintenant: () => etat.t,
    ecouterRetour: (f) => { etat.retour = f; return () => { etat.retour = null; }; },
    setInterval: (f) => { etat.tic = f; return 1; },
    clearInterval: () => { etat.arrete = true; },
  };
  return { etat, env };
}

describe('mise à jour automatique', () => {
  it('à chaque intervalle, seulement si l’onglet est visible et en ligne', () => {
    const { etat, env } = faux();
    const maj = vi.fn();
    programmerMiseAJour(maj, 60_000, env);
    etat.tic!(); expect(maj).toHaveBeenCalledTimes(1);
    etat.visible = false; etat.tic!(); expect(maj).toHaveBeenCalledTimes(1);
    etat.visible = true; etat.enLigne = false; etat.tic!(); expect(maj).toHaveBeenCalledTimes(1);
  });

  it('au retour sur l’onglet : immédiate si la dernière date d’au moins 30 s, sinon rien', () => {
    const { etat, env } = faux();
    const maj = vi.fn();
    programmerMiseAJour(maj, 60_000, env);
    etat.t = DELAI_RETOUR_ONGLET_MS - 1; etat.retour!(); expect(maj).not.toHaveBeenCalled();
    etat.t = DELAI_RETOUR_ONGLET_MS; etat.retour!(); expect(maj).toHaveBeenCalledTimes(1);
    etat.t += 1000; etat.retour!(); expect(maj).toHaveBeenCalledTimes(1);
  });

  it('l’arrêt coupe la minuterie et l’écoute', () => {
    const { etat, env } = faux();
    programmerMiseAJour(vi.fn(), 60_000, env)();
    expect(etat.arrete).toBe(true);
    expect(etat.retour).toBeNull();
  });
});
