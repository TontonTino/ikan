"""
Modèle Agence — point de service d'une organisation.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Boolean, ForeignKey, Float, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Agence(Base):
    __tablename__ = "agences"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False
    )
    nom: Mapped[str] = mapped_column(String(255), nullable=False)
    adresse: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ville: Mapped[str | None] = mapped_column(String(100), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Seuil d'alerte satisfaction (configurable par l'admin, défaut 80%)
    seuil_alerte: Mapped[float] = mapped_column(Float, default=80.0)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    organisation: Mapped["Organisation"] = relationship(
        "Organisation", back_populates="agences"
    )
    qr_codes: Mapped[list["QRCode"]] = relationship(
        "QRCode", back_populates="agence", cascade="all, delete-orphan", passive_deletes=True
    )
    utilisateurs: Mapped[list["Utilisateur"]] = relationship(
        "Utilisateur", back_populates="agence"
    )

    def __repr__(self) -> str:
        return f"<Agence {self.nom} ({self.ville})>"
