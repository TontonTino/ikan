"""
Modèles Plan et PlanFeature — forfaits des organisations et leurs fonctionnalités.
Les limites nullables signifient « illimité ».
"""
import uuid

from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    nom: Mapped[str] = mapped_column(String(100), nullable=False)
    ordre: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_cx_managers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_agences: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_feedbacks_mois: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"<Plan {self.code}>"


class PlanFeature(Base):
    __tablename__ = "plan_features"
    __table_args__ = (UniqueConstraint("plan_id", "feature_code", name="uq_plan_feature"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("plans.id", ondelete="CASCADE"), nullable=False
    )
    feature_code: Mapped[str] = mapped_column(String(80), nullable=False)
