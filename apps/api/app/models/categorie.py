"""
Modèle Categorie — catégorie de feedback définie par le CX Manager, propre à une agence.
Remplace la classification thématique IA : le client choisit lui-même la catégorie
concernée sur le formulaire, avant soumission de son avis.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Categorie(Base):
    __tablename__ = "categories_agence"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    agence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agences.id", ondelete="CASCADE"), nullable=False
    )
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    agence: Mapped["Agence"] = relationship("Agence", back_populates="categories")

    def __repr__(self) -> str:
        return f"<Categorie {self.nom} agence={self.agence_id}>"
