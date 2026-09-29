"""
Modèle Issue — problème réel potentiellement signalé par plusieurs feedbacks, distinct
d'un feedback individuel. V1 volontairement limitée : création et rattachement manuels
uniquement (CX Manager ou Agency Manager) — pas de suggestion IA de regroupement, pas de
clustering automatique, pas de dashboard ni de KPI dédiés (voir app/api/v1/endpoints/issues.py).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, Boolean, DateTime, Enum, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import CriticiteType


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agences.id", ondelete="CASCADE"), nullable=False
    )
    titre: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ouverte | action_en_cours | resolue | verifiee | reouverte
    statut: Mapped[str] = mapped_column(String(30), nullable=False, default="ouverte")
    severite: Mapped[CriticiteType] = mapped_column(Enum(CriticiteType), nullable=False, default=CriticiteType.FAIBLE)
    categorie_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories_agence.id", ondelete="SET NULL"), nullable=True
    )
    theme_principal: Mapped[str | None] = mapped_column(String(100), nullable=True)
    necessite_action: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    premiere_detection: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    derniere_detection: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    date_resolution: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    date_verification: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relations (lecture seule, pas de back_populates : ne modifie pas Agence/Organisation/Categorie)
    agence: Mapped["Agence"] = relationship("Agence", foreign_keys=[agence_id], viewonly=True)
    categorie: Mapped["Categorie | None"] = relationship("Categorie", foreign_keys=[categorie_id], viewonly=True)

    def __repr__(self) -> str:
        return f"<Issue {self.titre!r} statut={self.statut} severite={self.severite}>"
