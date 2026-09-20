"""
Catalogue des forfaits — source unique des plans, de leurs limites et de leurs
fonctionnalités. Utilisé par la migration Alembic 006, le filet de démarrage
idempotent (app/main.py), le service de vérification et les tests.

Deux familles de codes de fonctionnalité :
- GATED : réellement vérifiés dans le code (pipeline, endpoints).
- MARKETING : listés pour l'affichage commercial du forfait Entreprise
  uniquement. Aucune implémentation derrière, et AUCUNE vérification
  technique ne doit jamais les référencer dans le code.
"""
import uuid

# UUID fixes : PostgreSQL n'autorise pas de sous-requête dans un DEFAULT de
# colonne, le plan par défaut (Gratuit) est donc référencé par son UUID.
PLAN_GRATUIT_ID = uuid.UUID("6f1a0000-0000-4000-8000-000000000001")
PLAN_STARTER_ID = uuid.UUID("6f1a0000-0000-4000-8000-000000000002")
PLAN_PRO_ID = uuid.UUID("6f1a0000-0000-4000-8000-000000000003")
PLAN_ENTREPRISE_ID = uuid.UUID("6f1a0000-0000-4000-8000-000000000004")

# Fonctionnalités de base : jamais gatées, même en cas de bug du service.
FEATURE_QR_FORMULAIRE = "qr_formulaire"
FEATURE_ANALYSE_SENTIMENT = "analyse_sentiment"
FEATURES_TOUJOURS_ACTIVES = frozenset({FEATURE_QR_FORMULAIRE, FEATURE_ANALYSE_SENTIMENT})

# Fonctionnalités réellement gatées.
FEATURE_CATEGORIES = "categories_personnalisees"
FEATURE_ALERTES = "alertes_satisfaction"
FEATURE_DISCORDANCE = "detection_discordance"

# Codes d'affichage marketing (Entreprise), sans vérification technique.
FEATURES_MARKETING = (
    "agent_ia_conversationnel",
    "analyse_predictive",
    "crm_whatsapp",
    "rapports_executifs",
)

# Fonctionnalités vérifiables techniquement (l'ordre = ordre d'affichage).
FEATURES_GATEES = (
    FEATURE_QR_FORMULAIRE,
    FEATURE_ANALYSE_SENTIMENT,
    FEATURE_CATEGORIES,
    FEATURE_ALERTES,
    FEATURE_DISCORDANCE,
)

# Affichés « À venir » pour TOUS les forfaits : aucune implémentation, jamais vérifiés.
FEATURE_LIBELLES_A_VENIR = {
    "agent_ia_conversationnel": "Agent IA conversationnel",
    "analyse_predictive": "Analyse prédictive (IA)",
    "crm_whatsapp": "Intégration CRM & WhatsApp",
    "rapports_executifs": "Rapports IA exécutifs automatiques",
}

FEATURE_LIBELLES = {
    FEATURE_QR_FORMULAIRE: "QR code et formulaire client",
    FEATURE_ANALYSE_SENTIMENT: "Analyse du sentiment",
    FEATURE_CATEGORIES: "Catégories personnalisées",
    FEATURE_ALERTES: "Alertes de satisfaction",
    FEATURE_DISCORDANCE: "Détection de discordance",
}

# code -> (id, nom, ordre, max_cx_managers, max_agences, max_feedbacks_mois)
# None = illimité.
PLANS = {
    "gratuit": (PLAN_GRATUIT_ID, "Gratuit", 1, 1, 1, 20),
    "starter": (PLAN_STARTER_ID, "Starter", 2, 1, 3, None),
    "pro": (PLAN_PRO_ID, "Pro", 3, 3, 10, None),
    "entreprise": (PLAN_ENTREPRISE_ID, "Entreprise", 4, None, None, None),
}

_BASE = (FEATURE_QR_FORMULAIRE, FEATURE_ANALYSE_SENTIMENT)
_STARTER = _BASE + (FEATURE_CATEGORIES, FEATURE_ALERTES)
_PRO = _STARTER + (FEATURE_DISCORDANCE,)
_ENTREPRISE = _PRO + FEATURES_MARKETING

PLAN_FEATURES = {
    "gratuit": _BASE,
    "starter": _STARTER,
    "pro": _PRO,
    "entreprise": _ENTREPRISE,
}

# Correspondance forfait payant -> Price Stripe (mode test tant que STRIPE_SECRET_KEY
# est une clé sk_test_...). Gratuit n'a pas de Price (pas de Stripe), Entreprise reste
# sur devis manuel (pas de Price non plus). Créés/rejoués via scripts/create_stripe_products.py.
STRIPE_PRICE_IDS = {
    "starter": "price_1UHq6tRNRfbHByow6doEMM8I",
    "pro": "price_1UHq6uRNRfbHByowlQbEYfoD",
}
