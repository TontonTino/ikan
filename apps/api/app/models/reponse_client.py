"""
Modèle ReponseClient — Enregistrement des communications adressées aux clients.
Permet d'historiser les réponses envoyées via différents canaux (téléphone, email, WhatsApp, SMS).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class ReponseClient(Base):
    __tablename__ = "reponses_clients"

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
    canal: Mapped[str] = mapped_column(String(50), nullable=False, default="telephone")
    contenu: Mapped[str] = mapped_column(Text, nullable=False)
    date_envoi: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    feedback: Mapped["Feedback"] = relationship(
        "Feedback", back_populates="reponses_client"
    )
    utilisateur: Mapped["Utilisateur"] = relationship(
        "Utilisateur", foreign_keys=[utilisateur_id]
    )

    def __repr__(self) -> str:
        return f"<ReponseClient feedback={self.feedback_id} canal={self.canal} by {self.auteur_nom}>"
