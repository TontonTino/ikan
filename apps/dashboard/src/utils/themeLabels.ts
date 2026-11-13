/**
 * Libellé UNIQUE de chaque thème détecté par l'analyse (clés de apps/api/app/services/ai/categories.yaml), en majuscule
 * initiale seulement (lot 4). Même texte que THEME_LABELS_MAP côté API (dashboard_statistics_shared.py) : un test vérifie
 * que les deux correspondent et que chaque clé de l'API a son libellé.
 */
export const THEME_LABELS: Record<string, string> = {
  attente: 'Attente & délais',
  accueil: 'Accueil & amabilité',
  disponibilite_accessibilite: 'Disponibilité & horaires',
  tarifs: 'Tarifs & frais',
  qualite_produit: 'Qualité des produits & services',
  proprete_cadre: 'Propreté & cadre',
  application_mobile: 'Application mobile & services en ligne',
  reseau: 'Réseau & couverture',
  facturation: 'Facturation',
  communication_information: 'Information & clarté',
  livraison_logistique: 'Livraison & logistique',
  resolution_probleme: 'Prise en charge & SAV',
  securite_confidentialite: 'Sécurité & confidentialité',
  disponibilite_produit: 'Disponibilité des stocks & offres',
  personnalisation_besoin: 'Écoute & conseil personnalisé',
  autre: 'Autres motifs',
};

/**
 * Majuscule initiale seulement : « Internet & Réseau Mobile » devient « Internet & réseau mobile ». Les sigles (SIM, SAV,
 * 4G) et les mots déjà en minuscules sont gardés tels quels. Sert aux noms de catégories saisis par les organisations.
 */
export function enMajusculeInitiale(texte: string): string {
  const mots = texte.trim().split(/(\s+)/);
  let premier = true;
  return mots
    .map((mot) => {
      if (/^\s+$/.test(mot) || mot === '') return mot;
      if (premier) {
        premier = false;
        return mot.charAt(0).toLocaleUpperCase('fr-FR') + mot.slice(1);
      }
      // Mot en « Majuscule initiale » (pas un sigle) : passé en minuscules.
      return /^\p{Lu}[\p{Ll}'’-]+$/u.test(mot) ? mot.toLocaleLowerCase('fr-FR') : mot;
    })
    .join('');
}

export const themeLabel = (theme: string | null | undefined): string => {
  if (!theme) return 'Non classé';
  if (THEME_LABELS[theme]) return THEME_LABELS[theme];
  // Libellé personnalisé (espaces, majuscules, accents…) : même règle de casse, sans retraduction.
  if (!/^[a-z0-9_]+$/.test(theme)) return enMajusculeInitiale(theme);
  return enMajusculeInitiale(theme.replace(/_/g, ' '));
};
