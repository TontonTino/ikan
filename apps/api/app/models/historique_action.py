"""
Modèle HistoriqueAction — journal d'audit des actions administratives (BNF-09).
Trace les actions sur les comptes utilisateurs et configurations.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class HistoriqueAction(Base):
    __tablename__ = "historique_actions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    entite_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entite_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    adresse_ip: Mapped[str | None] = mapped_column(String(50), nullable=True)
    date_action: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relations
    utilisateur: Mapped["Utilisateur"] = relationship(
        "Utilisateur", back_populates="historique_actions"
    )

    def __repr__(self) -> str:
        return f"<HistoriqueAction {self.action} by {self.utilisateur_id}>"
