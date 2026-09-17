"""
Modèle Recommandation — action suggérée par l'IA à l'Agency Manager (BF-17).
Générée pour chaque feedback de criticité Élevée ou Critique.
"""
import uuid
from datetime import datetime

from sqlalchemy import Text, DateTime, ForeignKey, Enum, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import PriorityLevel


class Recommandation(Base):
    __tablename__ = "recommandations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    analyse_ia_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analyses_ia.id", ondelete="CASCADE"), nullable=False
    )
    contenu: Mapped[str] = mapped_column(Text, nullable=False)
    priorite: Mapped[PriorityLevel] = mapped_column(Enum(PriorityLevel), nullable=False)
    date_generation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    traitee: Mapped[bool] = mapped_column(default=False)

    # Relations
    analyse_ia: Mapped["AnalyseIA"] = relationship(
        "AnalyseIA", back_populates="recommandations"
    )

    def __repr__(self) -> str:
        return f"<Recommandation priorite={self.priorite}>"
