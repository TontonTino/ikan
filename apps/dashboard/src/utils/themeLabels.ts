export const THEME_LABELS: Record<string, string> = {
  attente: 'Attente & Délais en caisse',
  accueil: 'Accueil & Conseillers',
  disponibilite_accessibilite: 'Accessibilité & Horaires',
  tarifs: 'Tarifs & Frais',
  qualite_produit: 'Qualité Produit & Forfaits',
  proprete_cadre: 'Propreté & Cadre agence',
  application_mobile: 'Application Mobile & E-espace',
  reseau: 'Réseau 4G/5G & Connexion',
  facturation: 'Facturation & Prélèvements',
  communication_information: 'Communication & Conseils',
  livraison_logistique: 'Livraison & Disponibilité SIM',
  resolution_probleme: 'SAV & Résolution',
  securite_confidentialite: 'Sécurité & Confidentialité',
  disponibilite_produit: 'Disponibilité Stocks / Terminaux',
  personnalisation_besoin: 'Écoute & Personnalisation',
};

export const themeLabel = (theme: string) => THEME_LABELS[theme] || theme;
