import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({
  default: {
    create: () => ({ get, interceptors: { response: { use: vi.fn() } } }),
  },
}));

import { feedbacksApi } from './api';

describe('API des thèmes et des avis filtrés', () => {
  beforeEach(() => get.mockReset());

  it('transmet thème, périmètre agence et période au filtrage serveur', () => {
    const params = { theme: 'qualite_produit', agence_id: 'agency-1', date_debut: '2026-10-01T00:00:00.000Z', limit: 50, offset: 0 };
    feedbacksApi.list(params);
    expect(get).toHaveBeenCalledWith('/feedbacks/', { params });
  });

  it('charge le catalogue de thèmes hors pagination et pour l’agence demandée', () => {
    feedbacksApi.themes({ agence_id: 'agency-1' });
    expect(get).toHaveBeenCalledWith('/feedbacks/themes', { params: { agence_id: 'agency-1' } });
  });
});
