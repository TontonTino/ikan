"""
Modèle AnalyseIA — résultat de l'analyse automatique d'un feedback.
Contient le sentiment, la criticité, le thème principal.
"""
import uuid
from datetime import datetime

from sqlalchemy import Text, DateTime, ForeignKey, Enum, String, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import SentimentType, CriticiteType


class AnalyseIA(Base):
    __tablename__ = "analyses_ia"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedbacks.id", ondelete="CASCADE"),
        nullable=False, unique=True
    )
    sentiment: Mapped[SentimentType] = mapped_column(Enum(SentimentType), nullable=False)
    criticite: Mapped[CriticiteType] = mapped_column(Enum(CriticiteType), nullable=False)
    theme_principal: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Discordance : note haute (>=4) mais commentaire négatif (BF-08)
    discordance_detectee: Mapped[bool] = mapped_column(Boolean, default=False)
    # Score de sentiment (0.0 = très négatif, 1.0 = très positif)
    score_sentiment: Mapped[float | None] = mapped_column(nullable=True)
    date_analyse: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="analyse_ia")
    recommandations: Mapped[list["Recommandation"]] = relationship(
        "Recommandation", back_populates="analyse_ia", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<AnalyseIA sentiment={self.sentiment} criticite={self.criticite}>"
