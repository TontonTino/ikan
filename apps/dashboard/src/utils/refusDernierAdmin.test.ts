import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { messageRefusServeur } from './userFacingError';

const refus409 = (detail: string) =>
  new AxiosError('refus', 'ERR_BAD_REQUEST', undefined, undefined, { status: 409, data: { detail }, statusText: '', headers: {}, config: {} as never } as AxiosResponse);

// Messages écrits par app/services/administrateurs.py : l'écran les affiche tels quels (suppression d'organisation, suspension de compte).
describe('refus « dernier administrateur » (409)', () => {
  it('reprend le message du dernier administrateur actif', () => {
    const message = 'Cette opération retirerait le dernier administrateur actif de la plateforme.';
    expect(messageRefusServeur(refus409(message))).toBe(message);
  });

  it('reprend le message d’auto-protection', () => {
    const message = 'Vous ne pouvez pas désactiver, rétrograder ni supprimer votre propre compte administrateur, ni l\'organisation qui le contient.';
    expect(message.length).toBeLessThanOrEqual(300);
    expect(messageRefusServeur(refus409(message))).toBe(message);
  });
});
