export const THEME_LABELS: Record<string, string> = {
  attente: 'Attente & Délais en caisse',
  accueil: 'Accueil & Conseillers',
  disponibilite_accessibilite: 'Disponibilité / accessibilité',
  tarifs: 'Tarifs & Frais',
  qualite_produit: 'Qualité du produit',
  proprete_cadre: 'Propreté du cadre',
  application_mobile: 'Application Mobile & E-espace',
  reseau: 'Réseau 4G/5G & Connexion',
  facturation: 'Facturation',
  communication_information: 'Communication & Conseils',
  livraison_logistique: 'Livraison & Disponibilité SIM',
  resolution_probleme: 'SAV & Résolution',
  securite_confidentialite: 'Sécurité & Confidentialité',
  disponibilite_produit: 'Disponibilité Stocks / Terminaux',
  personnalisation_besoin: 'Écoute & Personnalisation',
};

export const themeLabel = (theme: string | null | undefined): string => {
  if (!theme) return 'Non classé';
  if (THEME_LABELS[theme]) return THEME_LABELS[theme];
  return theme.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('fr-FR'));
};
