"""
Schémas Pydantic pour les analyses IA.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.enums import SentimentType, CriticiteType


class AnalyseIAResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID
    sentiment: SentimentType
    criticite: CriticiteType
    theme_principal: str | None
    discordance_detectee: bool
    score_sentiment: float | None
    date_analyse: datetime

    model_config = {"from_attributes": True}
