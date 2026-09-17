"""
Modèle SystemSettings — configuration générale de la plateforme IKAN AI.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Float, Boolean, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    nom_application: Mapped[str] = mapped_column(
        String(255), default="IKAN AI — Plateforme Feedback Client"
    )
    seuil_alerte_defaut: Mapped[float] = mapped_column(Float, default=80.0)
    retention_mois: Mapped[int] = mapped_column(Integer, default=24)
    mode_ia: Mapped[str] = mapped_column(String(50), default="deterministique")
    notifications_email_actives: Mapped[bool] = mapped_column(Boolean, default=True)
    date_modification: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<SystemSettings app={self.nom_application} seuil={self.seuil_alerte_defaut}%>"
