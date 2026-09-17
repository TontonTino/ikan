import axios from 'axios';

const isLocal = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.168.')
);

const API_BASE_URL = import.meta.env.VITE_API_URL || (isLocal ? '/api/v1' : 'https://ikanai-api.onrender.com/api/v1');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Envoie les cookies HTTP-only
  timeout: 30000, // 30 secondes max pour éviter les blocages infinis
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour gérer les 401 (session expirée sur les routes protégées)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me');
    if (error.response?.status === 401 && !isAuthEndpoint) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
};

// ── Dashboard ─────────────────────────────────────────
export const dashboardApi = {
  agence: (agenceId: string, jours = 30) =>
    api.get(`/dashboard/agence/${agenceId}?jours=${jours}`),
  siege: (jours = 30) =>
    api.get(`/dashboard/siege?jours=${jours}`),
  admin: () =>
    api.get('/dashboard/admin'),
};

// ── Statistiques & Analyses Dédiées ───────────────────
export const statisticsApi = {
  cx: (params?: { jours?: number; agence_id?: string }) =>
    api.get<import('../types').StatsCXResponse>('/dashboard/statistics/cx', { params }),
  agency: (params?: { jours?: number }) =>
    api.get<import('../types').StatsAgenceResponse>('/dashboard/statistics/agency', { params }),
  admin: (params?: { jours?: number }) =>
    api.get<import('../types').StatsAdminResponse>('/dashboard/statistics/admin', { params }),
};

// ── Feedbacks ─────────────────────────────────────────
export const feedbacksApi = {
  list: (params?: { agence_id?: string; statut?: string; limit?: number; offset?: number }) =>
    api.get('/feedbacks/', { params }),
  get: (feedbackId: string) =>
    api.get(`/feedbacks/${feedbackId}`),
  open: (feedbackId: string) =>
    api.post(`/feedbacks/${feedbackId}/open`),
  addNote: (feedbackId: string, texte: string) =>
    api.post(`/feedbacks/${feedbackId}/notes`, { texte }),
  envoyerSuggestionAgence: (feedbackId: string, suggestion: string) =>
    api.post(`/feedbacks/${feedbackId}/suggestion-agence`, { suggestion }),
  definirActionCX: (feedbackId: string, action: string) =>
    api.post(`/feedbacks/${feedbackId}/action-cx`, { action }),
  confirmerActionRealisee: (feedbackId: string) =>
    api.post(`/feedbacks/${feedbackId}/confirmer-action`),
  envoyerReponseClient: (feedbackId: string, contenu: string, canal: string = 'telephone') =>
    api.post(`/feedbacks/${feedbackId}/reponses-client`, { contenu, canal }),
  reouvrir: (feedbackId: string) =>
    api.post(`/feedbacks/${feedbackId}/reouvrir`),
  getHistorique: (feedbackId: string) =>
    api.get<import('../types').HistoriqueFeedback[]>(`/feedbacks/${feedbackId}/historique`),
  getReponses: (feedbackId: string) =>
    api.get<import('../types').ReponseClient[]>(`/feedbacks/${feedbackId}/reponses`),
  traiterDemandeContact: (contactId: string) =>
    api.patch(`/feedbacks/demandes-contact/${contactId}/traiter`),
};

// ── Suggestions ───────────────────────────────────────
export const suggestionsApi = {
  list: () => api.get('/suggestions/'),
  updateStatut: (id: string, statut: string, commentaire?: string) =>
    api.patch(`/suggestions/${id}/statut`, { statut, commentaire }),
};

// ── Recommandations ───────────────────────────────────
export const recommandationsApi = {
  listAgence: (agenceId: string) =>
    api.get(`/recommandations/agences/${agenceId}`),
  marquerTraitee: (id: string) =>
    api.patch(`/recommandations/${id}/traiter`),
};

// ── Alertes ───────────────────────────────────────────
export const alertesApi = {
  list: () => api.get('/alertes/'),
  updateSeuil: (agenceId: string, seuil: number) =>
    api.patch(`/alertes/agences/${agenceId}/seuil`, { seuil_alerte: seuil }),
};

// ── Organisations ─────────────────────────────────────
export const organisationsApi = {
  list: () => api.get('/organisations/'),
  create: (data: object) => api.post('/organisations/', data),
  update: (id: string, data: object) => api.patch(`/organisations/${id}`, data),
  delete: (id: string) => api.delete(`/organisations/${id}`),
};

// ── Agences ───────────────────────────────────────────
export const agencesApi = {
  list: () => api.get('/agences/'),
  create: (orgId: string, data: object) => api.post('/agences/', data, { params: orgId ? { org_id: orgId } : undefined }),
  update: (id: string, data: object) => api.patch(`/agences/${id}`, data),
  delete: (id: string) => api.delete(`/agences/${id}`),
  updateSeuil: (id: string, seuil: number) => api.patch(`/agences/${id}`, { seuil_alerte: seuil }),
};

// ── Utilisateurs ──────────────────────────────────────
export const utilisateursApi = {
  list: () => api.get('/utilisateurs/'),
  create: (data: object) => api.post('/utilisateurs/', data),
  update: (id: string, data: object) => api.patch(`/utilisateurs/${id}`, data),
  delete: (id: string) => api.delete(`/utilisateurs/${id}`),
};

// ── Système (Settings & Permissions) ──────────────────
export const systemApi = {
  getSettings: () => api.get('/system/settings'),
  updateSettings: (data: object) => api.patch('/system/settings', data),
  getPermissions: () => api.get('/system/permissions'),
};

