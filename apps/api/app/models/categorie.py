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
    # Marque les feedbacks de cette catégorie comme alertes "suggestion" (voir
    # app/services/alertes_feedback.py). Nom volontairement distinct du modèle
    # Suggestion (idée client en texte libre, concept sans rapport) pour éviter
    # toute confusion terminologique entre les deux.
    est_categorie_suggestion: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Traçabilité du créateur (CX Manager ou Agency Manager) : détermine qui peut
    # modifier/désactiver la catégorie. NULL = catégorie créée avant cette fonctionnalité
    # (toujours par un CX Manager, seul rôle habilité à l'époque).
    cree_par_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    cree_par_role: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Relations
    agence: Mapped["Agence"] = relationship("Agence", back_populates="categories")

    def __repr__(self) -> str:
        return f"<Categorie {self.nom} agence={self.agence_id}>"
