"""
Modèle DemandeContact — demande de rappel ou de contact liée à un feedback.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, ForeignKey, Integer, func
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
    # Consentement à être recontacté (nullable : demandes antérieures à la migration 030, sans consentement enregistré).
    consentement_contact: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    consentement_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Durée de conservation (mois) affichée au client au moment où il a consenti : preuve de ce qui a été accepté.
    consentement_retention_mois: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Traitement (migration 032) : date du premier traitement et auteur. NULL pour les demandes traitées avant 032 et tant que la
    # demande n'est pas traitée. Écrits uniquement par app/services/demandes_contact.py.
    date_traitement: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    traitee_par_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL", name="fk_demandes_contact_traitee_par_id"), nullable=True
    )

    # Relations
    feedback: Mapped["Feedback"] = relationship("Feedback", back_populates="demande_contact")
    traitee_par: Mapped["Utilisateur | None"] = relationship("Utilisateur", foreign_keys=[traitee_par_id])

    @property
    def traitee_par_nom(self) -> str | None:
        """Nom de l'auteur du traitement (None si inconnu : traitée avant la migration 032, ou compte supprimé)."""
        auteur = self.traitee_par
        return f"{auteur.prenom} {auteur.nom}" if auteur is not None else None

    def __repr__(self) -> str:
        return f"<DemandeContact {self.nom} rappel={self.souhaite_etre_rappele}>"
