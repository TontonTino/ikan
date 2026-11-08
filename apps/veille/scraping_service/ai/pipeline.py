"""Pipeline d'analyse IA pour les retours et commentaires collectés (IKAN AI).

Permet la classification de sentiment, la détection de thèmes/catégories et
l'attribution d'un score de confiance sur chaque FeedbackItem.
"""

from datetime import datetime, timezone
import re
from typing import Any, Protocol

from scraping_service.base import FeedbackItem


class AIAnalysisProvider(Protocol):
    """Contrat d'un fournisseur d'analyse IA (LLM, service distant, ou heuristique)."""

    async def analyze(self, text: str) -> dict[str, Any]: ...


class RuleBasedAIAnalyzer:
    """Analyseur sémantique et thématique intégré (rapide, déterministe et sans dépendance réseau)."""

    POSITIVE_WORDS = {
        "bon", "super", "excellent", "merci", "rapide", "professionnel", "top", "parfait",
        "bravo", "adore", "aimé", "recommande", "qualité", "efficace", "agréable", "satisfait",
        "facile", "intuitif", "intuitive", "clair", "formidable", "génial", "utile", "pratique",
        "great", "awesome", "good", "fast", "love", "helpful", "amazing", "best", "easy", "intuitive"
    }
    NEGATIVE_WORDS = {
        "mauvais", "nul", "lent", "horrible", "déçu", "incompétent", "arnaque", "problème",
        "erreur", "pire", "catastrophe", "voleurs", "inadmissible", "décevant", "bug",
        "souci", "défaut",
        "bad", "terrible", "worst", "slow", "broken", "scam", "disappointed", "poor"
    }
    # « jamais » est un marqueur de négation (« jamais déçu » est positif), plus un mot négatif.
    NEGATORS = {
        "ne", "pas", "jamais", "rien", "guère", "guere", "aucun", "aucune",
        "sans", "ni", "not", "no", "never", "without", "hardly", "cannot",
    }
    # Une opposition ou une ponctuation ferme la portée de la négation.
    OPPOSITION_WORDS = {
        "mais", "cependant", "toutefois", "pourtant", "néanmoins", "neanmoins", "but", "however",
    }
    NEGATION_WINDOW = 3
    PUNCTUATION = {".", ",", ";", ":", "!", "?", "(", ")", "[", "]", "\n", "—", "–"}

    THEMES_KEYWORDS = {
        "service_client": ["service", "support", "conseiller", "équipe", "réponse", "accueil", "agent", "contact"],
        "qualite_produit": ["qualité", "produit", "fonctionnalité", "plateforme", "logiciel", "outil", "application", "app"],
        "prix_facturation": ["prix", "cher", "tarif", "facture", "remboursement", "abonnement", "coût", "payer"],
        "livraison_delais": ["livraison", "délai", "retard", "temps", "attente", "colis", "rapide", "réception"],
        "experience_utilisateur": ["interface", "utilisation", "facile", "simple", "intuitif", "intuitive", "ergonomie", "design", "utiliser", "expérience", "navigation"],
    }

    def _polarity_score(self, cleaned: str) -> int:
        """Score signé (positifs − négatifs) ; un marqueur de négation inverse les mots polarisés
        qui le suivent dans une fenêtre de quelques mots, jusqu'à la ponctuation ou une opposition."""
        # Élisions et contractions ramenées à un marqueur explicite : « n'est » → « ne est »,
        # « don't » → « do not ». Les autres élisions (j'adore, l'équipe) se découpent sur l'apostrophe.
        expanded = re.sub(r"\bn'", "ne ", cleaned)
        expanded = re.sub(r"n't\b", " not", expanded)
        tokens = re.findall(r"[.,;:!?()\[\]\n—–]|\w+", expanded)

        score = 0
        window = 0
        for token in tokens:
            if token in self.PUNCTUATION or token in self.OPPOSITION_WORDS:
                window = 0  # ponctuation ou opposition : la négation ne porte plus
            elif token in self.NEGATORS:
                window = self.NEGATION_WINDOW  # une double négation ne se re-inverse pas
            elif token in self.POSITIVE_WORDS:
                score += -1 if window > 0 else 1
                window = max(0, window - 1)
            elif token in self.NEGATIVE_WORDS:
                score += 1 if window > 0 else -1
                window = max(0, window - 1)
            elif window > 0:
                window -= 1
        return score

    async def analyze(self, text: str) -> dict[str, Any]:
        cleaned = (text or "").replace("’", "'").lower()
        score = self._polarity_score(cleaned)

        # Détermination du sentiment (libellés de sortie inchangés : positif / négatif / neutre)
        if score > 0:
            sentiment = "positif"
            confidence = min(0.70 + 0.10 * score, 0.98)
        elif score < 0:
            sentiment = "négatif"
            confidence = min(0.70 + 0.10 * abs(score), 0.98)
        else:
            sentiment = "neutre"
            confidence = 0.65

        # Détection de la catégorie / thème
        theme_scores: dict[str, int] = {}
        for theme_name, keywords in self.THEMES_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in cleaned)
            if score > 0:
                theme_scores[theme_name] = score

        if theme_scores:
            theme = max(theme_scores.items(), key=lambda x: x[1])[0]
        else:
            theme = "general"

        return {
            "sentiment": sentiment,
            "theme": theme,
            "confidence": round(confidence, 2),
        }


class AIPipeline:
    """Orchestrateur du traitement IA des feedbacks clients."""

    def __init__(self, provider: AIAnalysisProvider | None = None):
        self.provider = provider or RuleBasedAIAnalyzer()

    async def process_item(self, item: FeedbackItem) -> FeedbackItem:
        """Enrichit un FeedbackItem avec les résultats d'analyse IA."""
        analysis = await self.provider.analyze(item.text)
        return item.model_copy(
            update={
                "sentiment": analysis.get("sentiment", "neutre"),
                "theme": analysis.get("theme", "general"),
                "confidence": analysis.get("confidence", 0.5),
                "ai_analyzed_at": datetime.now(timezone.utc),
            }
        )

    async def process_batch(self, items: list[FeedbackItem]) -> list[FeedbackItem]:
        """Traite une liste d'éléments de feedback."""
        return [await self.process_item(item) for item in items]
