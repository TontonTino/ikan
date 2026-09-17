"""
Modèle HistoriqueFeedback — Journal d'audit et traçabilité pour chaque feedback (Closed-Loop).
Enregistre chaque transition de statut, note interne, suggestion, action et réponse client.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class HistoriqueFeedback(Base):
    __tablename__ = "historique_feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedbacks.id", ondelete="CASCADE"), nullable=False
    )
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    auteur_nom: Mapped[str] = mapped_column(String(200), nullable=False)
    auteur_role: Mapped[str] = mapped_column(String(50), nullable=False)
    agence_nom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    type_evenement: Mapped[str] = mapped_column(String(100), nullable=False)
    ancien_statut: Mapped[str | None] = mapped_column(String(50), nullable=True)
    nouveau_statut: Mapped[str | None] = mapped_column(String(50), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_evenement: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    feedback: Mapped["Feedback"] = relationship(
        "Feedback", back_populates="historique_evenements"
    )
    utilisateur: Mapped["Utilisateur"] = relationship(
        "Utilisateur", foreign_keys=[utilisateur_id]
    )

    def __repr__(self) -> str:
        return f"<HistoriqueFeedback {self.type_evenement} feedback={self.feedback_id} by {self.auteur_nom}>"
