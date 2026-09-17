"""
Modèle Utilisateur — CX Manager, Agency Manager, Administrateur.
Le client (qui scanne le QR code) n'a PAS de compte — feedbacks anonymes.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, ForeignKey, Enum, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import UserRole


class Utilisateur(Base):
    __tablename__ = "utilisateurs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False
    )
    # L'Agency Manager est rattaché à une agence spécifique
    agence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agences.id", ondelete="SET NULL"), nullable=True
    )
    nom: Mapped[str] = mapped_column(String(150), nullable=False)
    prenom: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    mot_de_passe_hash: Mapped[str] = mapped_column(String(500), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    derniere_connexion: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relations
    organisation: Mapped["Organisation"] = relationship(
        "Organisation", back_populates="utilisateurs", foreign_keys=[organisation_id]
    )
    agence: Mapped["Agence"] = relationship("Agence", back_populates="utilisateurs")
    historique_actions: Mapped[list["HistoriqueAction"]] = relationship(
        "HistoriqueAction", back_populates="utilisateur", cascade="all, delete-orphan"
    )

    @property
    def organisation_nom(self) -> str | None:
        return self.organisation.nom if self.organisation else None

    @property
    def organisation_logo(self) -> str | None:
        return self.organisation.logo if self.organisation else None

    @property
    def agence_nom(self) -> str | None:
        return self.agence.nom if self.agence else None

    def __repr__(self) -> str:
        return f"<Utilisateur {self.prenom} {self.nom} ({self.role})>"

