"""
Modèle ActionCorrective — action concrète décidée pour résoudre une Issue. Plusieurs
actions peuvent être rattachées à une même Issue ; l'Issue passe à "resolue" quand
toutes ses actions sont "terminee" (voir app/api/v1/endpoints/issues.py).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ActionCorrective(Base):
    __tablename__ = "actions_correctives"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    titre: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # creee | en_cours | terminee | annulee
    statut: Mapped[str] = mapped_column(String(30), nullable=False, default="creee")
    responsable_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    echeance: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    date_completion: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"<ActionCorrective {self.titre!r} statut={self.statut} issue={self.issue_id}>"
