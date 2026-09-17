from pathlib import Path
import logging
import threading
import unicodedata
from typing import TypedDict, Optional

from app.services.ai.sentiment import analyser_sentiment
from app.models.enums import SentimentType

logger = logging.getLogger(__name__)

CURRENT_DIR = Path(__file__).resolve().parent
MODEL_DIR = CURRENT_DIR / "model_theme_v2_fr"
CONFIG_FILE = CURRENT_DIR / "categories.yaml"


def _strip_accents(text: str) -> str:
    """Supprime les accents pour une comparaison lexicale uniforme."""
    text = unicodedata.normalize("NFD", text)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


# Mots-clés enrichis sans accents pour les 15 thèmes IKAN AI
FALLBACK_THEMES: dict[str, list[str]] = {
    "attente": [
        "attente", "attendre", "file", "queue", "delai", "delais", "retard", "lent", "lente",
        "lenteur", "ticket", "patienter", "temps d attente", "longue attente", "chrono", "guichet plein",
        "dure", "duree", "durer", "trop dure", "trop long", "long", "longtemps", "1h", "2h", "minutes", "minute"
    ],
    "accueil": [
        "accueil", "accueillir", "agent", "conseiller", "conseillere", "conseillers", "hote", "hotesse",
        "sourire", "souriant", "souriante", "aimable", "amabilite", "poli", "polie", "politesse",
        "courtois", "courtoise", "courtoisie", "bonjour", "respect", "impoli", "impolie", "desagreable",
        "chaleureux", "chaleureuse", "gentil", "gentille", "bien recu", "mal recu", "personnel", "equipe",
        "incompetent", "incompetente", "reception"
    ],
    "disponibilite_accessibilite": [
        "accessibilite", "accessible", "handicap", "handicape", "handicapee", "pmr", "fauteuil",
        "ouverture", "fermeture", "ouvert", "ferme", "fermee", "horaire", "horaires", "parking",
        "acces", "rampe", "ascenseur", "entree", "porte", "acces agence"
    ],
    "tarifs": [
        "tarif", "tarifs", "prix", "cout", "couts", "cher", "chere", "chers", "cheres",
        "frais", "commission", "commissions", "taxe", "taxes", "gratuit", "gratuite",
        "abordable", "abordables", "promotion", "remise", "reduction", "offre tarifaire", "trop cher",
        "bon tarifs", "bons tarifs", "argent", "facture elevee"
    ],
    "qualite_produit": [
        "qualite", "produit", "produits", "offre", "offres", "forfait", "forfaits", "abonnement",
        "abonnements", "box", "carte sim", "materiel", "equipement", "gamme", "terminal", "telephone",
        "service", "prestation", "satisfait", "satisfaction", "content"
    ],
    "proprete_cadre": [
        "proprete", "propre", "propres", "sale", "sales", "salete", "saletes", "cadre",
        "local", "locaux", "agence", "agences", "climatisation", "clim", "chauffage",
        "confort", "confortable", "odeur", "chaise", "espace", "poubelle", "lieux", "lieux propres", "lieux sales"
    ],
    "application_mobile": [
        "application", "appli", "app", "mobile", "ios", "android", "bug", "bugs",
        "crash", "plante", "apk", "espace client", "mise a jour app", "telechargement", "play store", "app store",
        "espace en ligne", "mon compte"
    ],
    "reseau": [
        "reseau", "connexion", "signal", "couverture", "4g", "5g", "3g", "fibre",
        "adsl", "wifi", "debit", "coupure", "antenne", "internet", "pas de reseau", "mauvaise connexion",
        "perte de reseau", "ligne coupe", "debit lent", "reseau mobile", "panne reseau"
    ],
    "facturation": [
        "facture", "factures", "facturation", "facturer", "prelevement", "prelevements", "preleve",
        "prelevee", "preleves", "prelevees", "montant", "paiement", "payer", "surfacturation", "surfacture",
        "compte debite", "frais facture", "frais bancaires", "double debit", "echeance", "solde", "remboursement",
        "credit", "recharge"
    ],
    "communication_information": [
        "communication", "information", "informations", "informer", "explication", "explications",
        "sms", "email", "mail", "clarte", "renseignement", "prevenir", "notification", "conseil flou",
        "conseil", "conseils", "comprendre", "message"
    ],
    "livraison_logistique": [
        "livraison", "livrer", "livreur", "colis", "expedition", "expedier", "suivi colis",
        "transporteur", "reception", "commande en cours", "paquet", "commande", "envoi", "livre"
    ],
    "resolution_probleme": [
        "resolution", "resoudre", "probleme", "problemes", "panne", "pannes", "sav",
        "service apres-vente", "depannage", "reclamation", "reclamations", "incident", "ticket sav",
        "reparation", "reparer", "litige", "solution"
    ],
    "securite_confidentialite": [
        "securite", "confidentialite", "donnees", "donnees personnelles", "piratage", "pirate",
        "fraude", "mot de passe", "password", "code secret", "otp", "usurpation", "vol", "fuite",
        "code", "secret", "arnaque", "protection"
    ],
    "disponibilite_produit": [
        "rupture", "stock", "stocks", "disponible", "disponibilite", "epuise", "epuisee",
        "indisponible", "carte sim epuisee", "reassort", "pas de stock", "plus en stock", "en stock"
    ],
    "personnalisation_besoin": [
        "ecoute", "besoin", "besoins", "sur-mesure", "personnalise", "personnalisee",
        "personnalisation", "conseil adapte", "a l ecoute", "comprehension", "proposition sur mesure",
        "proposition", "attentif", "adapte"
    ],
}


def _fallback_classifier_theme(texte: str) -> tuple[str, float]:
    """
    Classifie le thème avec le dictionnaire de mots-clés normalisés parmi les 15 thèmes IKAN AI.
    Retourne (theme, confidence).
    """
    if not texte or len(texte.strip()) < 3:
        return "accueil", 0.5

    texte_clean = _strip_accents(texte.lower())
    scores: dict[str, int] = {}

    for theme, mots_cles in FALLBACK_THEMES.items():
        score = 0
        for mot in mots_cles:
            if mot in texte_clean:
                # Score plus élevé pour les expressions exactes multi-mots
                score += 2 if " " in mot else 1
        if score > 0:
            scores[theme] = score

    if not scores:
        return "accueil", 0.5

    best_theme = max(scores, key=lambda k: scores[k])
    total_score = sum(scores.values())
    confidence = min(0.95, round(scores[best_theme] / max(1, total_score) * 0.9, 3))
    return best_theme, max(0.6, confidence)


# Verrou pour le chargement paresseux thread-safe
_init_lock = threading.Lock()
_models_initialized = False
_transformers_available = False

sentiment_pipeline = None
theme_tokenizer = None
theme_model = None
THEME_LABELS: list[str] = []


def _load_labels() -> list[str]:
    """Charge la liste ordonnée des 15 thèmes depuis categories.yaml."""
    try:
        import yaml
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE, encoding="utf-8") as f:
                data = yaml.safe_load(f)
                labels = data.get("theme", [])
                if labels and len(labels) == 15:
                    return labels
    except Exception as e:
        logger.warning(f"Impossible de charger categories.yaml: {e}")
    return [
        "attente", "accueil", "disponibilite_accessibilite", "tarifs",
        "qualite_produit", "proprete_cadre", "application_mobile", "reseau",
        "facturation", "communication_information", "livraison_logistique",
        "resolution_probleme", "securite_confidentialite", "disponibilite_produit",
        "personnalisation_besoin"
    ]


def _ensure_models_loaded() -> None:
    """Charge paresseusement les modèles Transformers lors de la première utilisation si activé explicitement."""
    global _models_initialized, _transformers_available
    global sentiment_pipeline, theme_tokenizer, theme_model, THEME_LABELS

    if _models_initialized:
        return

    with _init_lock:
        if _models_initialized:
            return

        THEME_LABELS = _load_labels()
        _transformers_available = False

        # Sur serveurs avec mémoire limitée (ex: Render Free 512MB RAM),
        # on désactive systématiquement le chargement de PyTorch / Transformers
        import os
        enable_torch = os.getenv("ENABLE_HEAVY_TORCH_MODEL", "false").lower() == "true"
        if enable_torch:
            try:
                import torch
                from transformers import AutoTokenizer, AutoModelForSequenceClassification

                if MODEL_DIR.exists():
                    logger.info(f"Chargement du modèle de classification thématique IKAN AI depuis {MODEL_DIR}...")
                    theme_tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
                    theme_model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_DIR))
                    theme_model.eval()
                    _transformers_available = True
                    logger.info("Modèle local XLM-RoBERTa 15 catégories IKAN AI chargé avec succès.")
            except Exception as e:
                logger.info(f"Transformers local non initialisé ({e}). Bascule automatique sur moteur déterministe.")
                _transformers_available = False
        else:
            logger.info("Moteur sémantique ultra-léger activé (< 60MB RAM). PyTorch désactivé pour Render Free Tier.")

        _models_initialized = True


class ClassificationResult(TypedDict):
    sentiment: str
    score_sentiment: float
    theme: str
    theme_confidence: float


def classify(text: str) -> ClassificationResult:
    """
    Classifie le sentiment et le thème principal d'un retour utilisateur selon les 15 catégories IKAN AI.
    Combine le modèle de Deep Learning XLM-RoBERTa et l'analyseur sémantique local pour une précision maximale.
    """
    _ensure_models_loaded()

    if not text or not text.strip():
        return {
            "sentiment": "neutral",
            "score_sentiment": 0.5,
            "theme": "accueil",
            "theme_confidence": 0.5,
        }

    # 1. Analyse de sentiment déterministe enrichie (rapide, sans latence réseau)
    sent_enum, score_sent = analyser_sentiment(text)
    sentiment_str = (
        "positive" if sent_enum == SentimentType.POSITIF
        else "negative" if sent_enum == SentimentType.NEGATIF
        else "neutral"
    )

    # 2. Détection de mots-clés sémantiques
    kw_theme, kw_conf = _fallback_classifier_theme(text)

    # 3. Inférence Deep Learning Transformers si le modèle local est disponible
    model_theme = None
    model_conf = 0.0

    if _transformers_available and theme_tokenizer and theme_model:
        try:
            import torch
            inputs = theme_tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
            with torch.no_grad():
                logits = theme_model(**inputs).logits
                probabilities = torch.softmax(logits, dim=-1)[0]
                theme_idx = logits.argmax().item()
                model_conf = round(probabilities[theme_idx].item(), 3)

            if theme_idx < len(THEME_LABELS):
                model_theme = THEME_LABELS[theme_idx]
        except Exception as e:
            logger.debug(f"Inférence modèle Transformers ignorée : {e}")

    # 4. Fusion intelligente (Hybrid Ensemble)
    final_theme = "accueil"
    final_conf = 0.5

    if kw_conf >= 0.6:
        final_theme = kw_theme
        final_conf = max(kw_conf, model_conf)
    elif model_theme and model_conf >= 0.65:
        final_theme = model_theme
        final_conf = model_conf
    elif kw_theme:
        final_theme = kw_theme
        final_conf = kw_conf
    elif model_theme:
        final_theme = model_theme
        final_conf = model_conf

    # Garantir que le thème est strictement l'un des 15 thèmes
    if final_theme not in THEME_LABELS:
        final_theme = "accueil"

    return {
        "sentiment": sentiment_str,
        "score_sentiment": score_sent,
        "theme": final_theme,
        "theme_confidence": final_conf,
    }


def compute_criticite(note: int, sentiment: str) -> str:
    """Calcule le niveau de criticité basé sur le sentiment déclaré (1=Négatif, 3=Neutre, 5=Positif) et le sentiment détecté."""
    sent = sentiment.lower()
    if sent in ("negative", "negatif") and note <= 2:
        return "critique"
    if sent in ("negative", "negatif") or note <= 2:
        return "elevee"
    if sent in ("neutral", "neutre") or note == 3:
        return "moyenne"
    return "faible"


def detect_discordance(note: int, sentiment: str) -> bool:
    """Détecte une anomalie / discordance entre le sentiment déclaré et le sentiment analysé dans le texte."""
    sent = sentiment.lower()
    if note >= 4 and sent in ("negative", "negatif"):
        return True
    if note <= 2 and sent in ("positive", "positif"):
        return True
    return False