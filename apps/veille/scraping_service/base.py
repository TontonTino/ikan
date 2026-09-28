from abc import ABC, abstractmethod
from datetime import datetime

from pydantic import BaseModel, Field


class FeedbackItem(BaseModel):
    """Format standardisé partagé par toutes les sources de veille (Facebook, Google Reviews, etc.)."""

    source: str  # ex: "facebook", "google_reviews"
    source_id: str
    target_url: str
    author_name: str | None = None
    text: str = Field(min_length=1)
    rating: float | None = None  # Note éventuelle (ex: 5.0 pour Google Reviews ou reco Facebook)
    published_at: datetime | None = None
    permalink: str | None = None
    raw_text: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class SourceScraper(ABC):
    """Contrat commun à toutes les sources (Facebook aujourd'hui, Google Reviews ensuite).

    Chaque source renvoie des FeedbackItem : le pipeline IA n'a pas à connaître l'origine.
    """

    source: str  # identifiant court : "facebook", "google_reviews", ...

    @abstractmethod
    async def fetch(self, target: str, max_items: int = 20) -> list[FeedbackItem]:
        """Récupère les avis/posts d'une cible (URL de page, identifiant de lieu...)."""
