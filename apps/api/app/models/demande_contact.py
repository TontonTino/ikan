"""
Modèle DemandeContact — demande de rappel ou de contact liée à un feedback.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class DemandeContact(Base):
    __tablename__ = "demandes_contact"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    feedback_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedbacks.id", ondelete="CASCADE"),
        nullable=False, unique=True
    )
    nom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    telephone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    souhaite_etre_rappele: Mapped[bool] = mapped_column(Boolean, default=False)
    date_demande: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    traitee: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relations
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="demande_contact")

    def __repr__(self) -> str:
        return f"<DemandeContact {self.nom} rappel={self.souhaite_etre_rappele}>"
