"""Libellés partagés par les vues statistiques du dashboard."""

# Même texte que THEME_LABELS du dashboard (apps/dashboard/src/utils/themeLabels.ts) : un libellé par clé, majuscule initiale
# seulement (lot 4). Un test du dashboard compare les deux.
THEME_LABELS_MAP: dict[str, str] = {
    "attente": "Attente & délais",
    "accueil": "Accueil & amabilité",
    "disponibilite_accessibilite": "Disponibilité & horaires",
    "tarifs": "Tarifs & frais",
    "qualite_produit": "Qualité des produits & services",
    "proprete_cadre": "Propreté & cadre",
    "application_mobile": "Application mobile & services en ligne",
    "reseau": "Réseau & couverture",
    "facturation": "Facturation",
    "communication_information": "Information & clarté",
    "livraison_logistique": "Livraison & logistique",
    "resolution_probleme": "Prise en charge & SAV",
    "securite_confidentialite": "Sécurité & confidentialité",
    "disponibilite_produit": "Disponibilité des stocks & offres",
    "personnalisation_besoin": "Écoute & conseil personnalisé",
    "autre": "Autres motifs",
}
