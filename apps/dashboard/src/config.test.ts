import { afterEach, describe, expect, it, vi } from 'vitest';

const charger = async () => {
  vi.resetModules();
  return (await import('./config')).YAM_PRESENCE;
};

afterEach(() => vi.unstubAllEnvs());

describe('YAM_PRESENCE (drapeau de retour arrière)', () => {
  it('actif par défaut', async () => {
    vi.stubEnv('VITE_YAM_PRESENCE', '');
    expect(await charger()).toBe(true);
  });

  it('coupé uniquement par VITE_YAM_PRESENCE=non', async () => {
    vi.stubEnv('VITE_YAM_PRESENCE', 'non');
    expect(await charger()).toBe(false);
  });

  it.each(['oui', 'true', 'NON', '0', 'false'])('toute autre valeur (%s) laisse YAM actif', async (valeur) => {
    vi.stubEnv('VITE_YAM_PRESENCE', valeur);
    expect(await charger()).toBe(true);
  });
});
