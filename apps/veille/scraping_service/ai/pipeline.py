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
        "erreur", "jamais", "pire", "catastrophe", "voleurs", "inadmissible", "décevant", "bug",
        "bad", "terrible", "worst", "slow", "broken", "scam", "disappointed", "poor"
    }

    THEMES_KEYWORDS = {
        "service_client": ["service", "support", "conseiller", "équipe", "réponse", "accueil", "agent", "contact"],
        "qualite_produit": ["qualité", "produit", "fonctionnalité", "plateforme", "logiciel", "outil", "application", "app"],
        "prix_facturation": ["prix", "cher", "tarif", "facture", "remboursement", "abonnement", "coût", "payer"],
        "livraison_delais": ["livraison", "délai", "retard", "temps", "attente", "colis", "rapide", "réception"],
        "experience_utilisateur": ["interface", "utilisation", "facile", "simple", "intuitif", "intuitive", "ergonomie", "design", "utiliser", "expérience", "navigation"],
    }

    async def analyze(self, text: str) -> dict[str, Any]:
        cleaned = text.lower()
        words = set(re.findall(r"\b\w+\b", cleaned))

        pos_matches = words.intersection(self.POSITIVE_WORDS)
        neg_matches = words.intersection(self.NEGATIVE_WORDS)

        # Détermination du sentiment
        if len(pos_matches) > len(neg_matches):
            sentiment = "positif"
            confidence = min(0.70 + 0.10 * len(pos_matches), 0.98)
        elif len(neg_matches) > len(pos_matches):
            sentiment = "négatif"
            confidence = min(0.70 + 0.10 * len(neg_matches), 0.98)
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
