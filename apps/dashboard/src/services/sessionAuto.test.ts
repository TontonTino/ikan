import { describe, expect, it, vi } from 'vitest';
import { creerGestionnaireSession } from './sessionAuto';

const erreur401 = (url: string, rejouee = false) => ({ config: { url, ...(rejouee ? { _sessionRejouee: true } : {}) }, response: { status: 401 } });

function monter(rafraichir = vi.fn().mockResolvedValue({})) {
  const rejouer = vi.fn().mockResolvedValue('réponse rejouée');
  const versConnexion = vi.fn();
  return { surErreur: creerGestionnaireSession({ rafraichir, rejouer, versConnexion }), rafraichir, rejouer, versConnexion };
}

describe('prolongation automatique de la session', () => {
  it('401 : rafraîchit puis rejoue la requête, sans renvoyer vers la connexion', async () => {
    const m = monter();
    await expect(m.surErreur(erreur401('/feedbacks/'))).resolves.toBe('réponse rejouée');
    expect(m.rafraichir).toHaveBeenCalledOnce();
    expect(m.rejouer).toHaveBeenCalledWith({ url: '/feedbacks/', _sessionRejouee: true });
    expect(m.versConnexion).not.toHaveBeenCalled();
  });

  it('plusieurs 401 simultanés : un seul rafraîchissement', async () => {
    let finir: (v: unknown) => void = () => {};
    const m = monter(vi.fn(() => new Promise((r) => { finir = r; })));
    const attentes = ['/a', '/b', '/c'].map((u) => m.surErreur(erreur401(u)));
    finir({});
    await Promise.all(attentes);
    expect(m.rafraichir).toHaveBeenCalledOnce();
    expect(m.rejouer).toHaveBeenCalledTimes(3);
  });

  it('rafraîchissement refusé : page de connexion, et l’erreur d’origine remonte', async () => {
    const m = monter(vi.fn().mockRejectedValue(new Error('expiré')));
    const e = erreur401('/alertes/');
    await expect(m.surErreur(e)).rejects.toBe(e);
    expect(m.versConnexion).toHaveBeenCalledOnce();
  });

  it('au chargement (/auth/me) : tente le rafraîchissement mais laisse le store décider, sans redirection', async () => {
    const ok = monter();
    await expect(ok.surErreur(erreur401('/auth/me'))).resolves.toBe('réponse rejouée');
    const ko = monter(vi.fn().mockRejectedValue(new Error('expiré')));
    await expect(ko.surErreur(erreur401('/auth/me'))).rejects.toBeTruthy();
    expect(ko.versConnexion).not.toHaveBeenCalled();
  });

  it('jamais de boucle : ni sur les routes d’authentification, ni sur une requête déjà rejouée, ni hors 401', async () => {
    const m = monter();
    for (const e of [erreur401('/auth/login'), erreur401('/auth/refresh'), erreur401('/x', true), { config: { url: '/x' }, response: { status: 403 } }]) {
      await expect(m.surErreur(e)).rejects.toBe(e);
    }
    expect(m.rafraichir).not.toHaveBeenCalled();
  });
});
