"""
Modèle AlerteQuotaEnvoyee — anti-spam des alertes de quota par email : une
seule alerte par organisation, métrique, seuil et cycle de facturation.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AlerteQuotaEnvoyee(Base):
    __tablename__ = "alertes_quota_envoyees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False
    )
    # "feedbacks" | "agences" | "cx_managers"
    metrique: Mapped[str] = mapped_column(String(20), nullable=False)
    # 80 ou 100
    seuil: Mapped[int] = mapped_column(Integer, nullable=False)
    cycle_facturation_debut: Mapped[date] = mapped_column(Date, nullable=False)
    envoyee_le: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<AlerteQuotaEnvoyee {self.organisation_id} {self.metrique}@{self.seuil} ({self.cycle_facturation_debut})>"
