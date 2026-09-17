"""
Modèle Suggestion — idée soumise par un client (BF-04, BF-11).
Tracée avec statut et historique d'audit (BNF-09).
"""
import uuid
from datetime import datetime

from sqlalchemy import Text, DateTime, ForeignKey, Enum, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import IdeaStatus


class Suggestion(Base):
    __tablename__ = "suggestions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedbacks.id", ondelete="CASCADE"), nullable=False
    )
    contenu: Mapped[str] = mapped_column(Text, nullable=False)
    statut: Mapped[IdeaStatus] = mapped_column(
        Enum(IdeaStatus), nullable=False, default=IdeaStatus.NOUVEAU
    )
    date_soumission: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    date_traitement: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes_internes: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # Relations
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="suggestion")
    historique: Mapped[list["HistoriqueSuggestion"]] = relationship(
        "HistoriqueSuggestion", back_populates="suggestion", cascade="all, delete-orphan", passive_deletes=True,
        order_by="HistoriqueSuggestion.date_action"
    )

    def __repr__(self) -> str:
        return f"<Suggestion {self.statut} feedback={self.feedback_id}>"


class HistoriqueSuggestion(Base):
    """Historique d'audit des changements de statut d'une suggestion (BNF-09)."""
    __tablename__ = "historique_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    suggestion_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("suggestions.id", ondelete="CASCADE"), nullable=False
    )
    ancien_statut: Mapped[IdeaStatus | None] = mapped_column(Enum(IdeaStatus), nullable=True)
    nouveau_statut: Mapped[IdeaStatus] = mapped_column(Enum(IdeaStatus), nullable=False)
    commentaire: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date_action: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )

    # Relations
    suggestion: Mapped["Suggestion"] = relationship(
        "Suggestion", back_populates="historique"
    )
