"""
Modèle Organisation — entité cliente de la plateforme IKAN AI (multi-tenant).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Organisation(Base):
    __tablename__ = "organisations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    nom: Mapped[str] = mapped_column(String(255), nullable=False)
    logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    secteur_activite: Mapped[str | None] = mapped_column(String(100), nullable=True, default="Télécommunications")
    pays_region: Mapped[str | None] = mapped_column(String(100), nullable=True, default="Tunisie / Afrique du Nord")
    email_pro: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Colonnes héritées (legacy) pour compatibilité
    secteur: Mapped[str | None] = mapped_column(String(100), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_creation: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, server_default=func.now())

    def __init__(self, **kwargs):
        if "email_pro" in kwargs and "email" not in kwargs:
            kwargs["email"] = kwargs["email_pro"]
        if "secteur_activite" in kwargs and "secteur" not in kwargs:
            kwargs["secteur"] = kwargs["secteur_activite"]
        super().__init__(**kwargs)

    # Relations
    agences: Mapped[list["Agence"]] = relationship(
        "Agence", back_populates="organisation", cascade="all, delete-orphan", passive_deletes=True
    )
    utilisateurs: Mapped[list["Utilisateur"]] = relationship(
        "Utilisateur", back_populates="organisation", foreign_keys="[Utilisateur.organisation_id]", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:
        return f"<Organisation {self.nom} ({self.email_pro})>"
