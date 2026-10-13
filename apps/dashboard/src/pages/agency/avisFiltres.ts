/**
 * Filtres et pagination de la liste des avis : TOUT est envoyé au serveur (GET /feedbacks/), rien n'est filtré dans le
 * navigateur. Module pur (sans React) : les règles se testent sans écran.
 */
export const TAILLE_PAGE = 25;
export const LONGUEUR_MAX_RECHERCHE = 100;

export type OngletAvis = 'tous' | 'a_traiter' | 'critiques' | 'thematiques';

export interface FiltresAvis {
  agenceId: string;
  periode: string; // 'all' | 'today' | '7' | '30' | '90' | '365'
  sentiment: string; // 'all' | 'positif' | 'neutre' | 'negatif'
  theme: string;
  note: string; // 'all' | '1'..'5'
  criticite: string; // 'all' | 'faible' | 'moyenne' | 'elevee' | 'critique' | 'non_evaluee'
  recherche: string;
  onglet: OngletAvis;
  page: number; // 0 = première page
}

export const FILTRES_INITIAUX: FiltresAvis = {
  agenceId: 'all', periode: 'all', sentiment: 'all', theme: 'all', note: 'all', criticite: 'all', recherche: '', onglet: 'tous', page: 0,
};

export type ActionFiltres =
  | { type: 'definir'; champ: Exclude<keyof FiltresAvis, 'page'>; valeur: string }
  | { type: 'page'; page: number }
  | { type: 'reinitialiser'; agenceId?: string };

/** Tout changement de filtre, de recherche ou d'onglet revient à la page 1 ; seul « page » la déplace. */
export function reduireFiltres(etat: FiltresAvis, action: ActionFiltres): FiltresAvis {
  switch (action.type) {
    case 'definir':
      return etat[action.champ] === action.valeur ? etat : { ...etat, [action.champ]: action.valeur, page: 0 };
    case 'page':
      return { ...etat, page: Math.max(0, action.page) };
    case 'reinitialiser':
      return { ...FILTRES_INITIAUX, agenceId: action.agenceId ?? 'all' };
  }
}

export const dateDebutPeriode = (periode: string, maintenant: Date = new Date()): Date | null => {
  if (periode === 'all') return null;
  const date = new Date(maintenant);
  date.setHours(0, 0, 0, 0);
  if (periode === 'today') return date;
  const jours = Number(periode);
  date.setDate(date.getDate() - (Number.isFinite(jours) && jours > 0 ? jours - 1 : 29));
  return date;
};

/** Recherche prête à envoyer : espaces retirés, plafonnée ; vide = pas de recherche. */
export const rechercheNormalisee = (saisie: string): string => saisie.trim().slice(0, LONGUEUR_MAX_RECHERCHE);

export interface ParametresAvis {
  limit: number;
  offset: number;
  agence_id?: string;
  date_debut?: string;
  theme?: string;
  sentiment?: string;
  criticite?: string;
  note?: number;
  q?: string;
  a_traiter?: true;
  a_surveiller?: true;
}

/**
 * Paramètres de GET /feedbacks/. `agenceFixe` : agence imposée par le contexte de la page (jamais un filtre retirable).
 * `sansOnglet` : pour compter un onglet donné indépendamment de l'onglet affiché.
 */
export function parametresApi(
  f: FiltresAvis,
  options: { agenceFixe?: string; onglet?: OngletAvis; limit?: number; offset?: number; maintenant?: Date } = {},
): ParametresAvis {
  const onglet = options.onglet ?? f.onglet;
  const agence = options.agenceFixe || (f.agenceId !== 'all' ? f.agenceId : undefined);
  const debut = dateDebutPeriode(f.periode, options.maintenant);
  const q = rechercheNormalisee(f.recherche);
  return {
    limit: options.limit ?? TAILLE_PAGE,
    offset: options.offset ?? f.page * TAILLE_PAGE,
    ...(agence ? { agence_id: agence } : {}),
    ...(debut ? { date_debut: debut.toISOString() } : {}),
    ...(f.theme !== 'all' ? { theme: f.theme } : {}),
    ...(f.sentiment !== 'all' ? { sentiment: f.sentiment } : {}),
    ...(f.criticite !== 'all' ? { criticite: f.criticite } : {}),
    ...(f.note !== 'all' ? { note: Number(f.note) } : {}),
    ...(q ? { q } : {}),
    ...(onglet === 'a_traiter' ? { a_traiter: true as const } : {}),
    ...(onglet === 'critiques' ? { a_surveiller: true as const } : {}),
  };
}

export const nombrePages = (total: number): number => Math.max(1, Math.ceil(total / TAILLE_PAGE));

export const libelleTotal = (total: number): string => `${total} avis`;

const LIBELLES_PERIODE: Record<string, string> = {
  today: "Aujourd'hui", '7': '7 derniers jours', '30': '30 derniers jours', '90': '90 derniers jours', '365': '12 derniers mois',
};
const LIBELLES_CRITICITE: Record<string, string> = { critique: 'Critique', elevee: 'Élevée', moyenne: 'Moyenne', faible: 'Faible', non_evaluee: 'Non évaluée' };
const LIBELLES_SENTIMENT: Record<string, string> = { positif: 'Positif', neutre: 'Neutre', negatif: 'Négatif' };

export interface FiltreActif { cle: Exclude<keyof FiltresAvis, 'page' | 'onglet'>; libelle: string }

/** Filtres actifs lisibles (l'agence fixée par la page n'en fait pas partie). */
export function filtresActifs(f: FiltresAvis, aide: { nomAgence?: (id: string) => string | undefined; libelleTheme: (t: string) => string; agenceFixe?: boolean }): FiltreActif[] {
  const liste: FiltreActif[] = [];
  if (!aide.agenceFixe && f.agenceId !== 'all') liste.push({ cle: 'agenceId', libelle: `Agence : ${aide.nomAgence?.(f.agenceId) || 'Sélectionnée'}` });
  if (f.sentiment !== 'all') liste.push({ cle: 'sentiment', libelle: `Ton : ${LIBELLES_SENTIMENT[f.sentiment] || f.sentiment}` });
  if (f.theme !== 'all') liste.push({ cle: 'theme', libelle: `Thème : ${f.theme === 'non_categorise' ? 'Non catégorisé' : aide.libelleTheme(f.theme)}` });
  if (f.periode !== 'all') liste.push({ cle: 'periode', libelle: `Période : ${LIBELLES_PERIODE[f.periode] || f.periode}` });
  if (f.note !== 'all') liste.push({ cle: 'note', libelle: `Note : ${f.note}/5` });
  if (f.criticite !== 'all') liste.push({ cle: 'criticite', libelle: `Gravité : ${LIBELLES_CRITICITE[f.criticite] || f.criticite}` });
  if (rechercheNormalisee(f.recherche)) liste.push({ cle: 'recherche', libelle: `Recherche : « ${rechercheNormalisee(f.recherche)} »` });
  return liste;
}
