"""
Modèle HistoriqueIssue — journal d'audit et traçabilité pour chaque Issue, même structure
que HistoriqueFeedback (auteur, rôle, date, ancien/nouveau statut). Table séparée plutôt
que réutilisation de HistoriqueFeedback : voir le rapport de la tâche pour la justification
(feedback_id y est NOT NULL, et une Issue n'est pas toujours liée à un feedback précis).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class HistoriqueIssue(Base):
    __tablename__ = "historique_issues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Renseigné uniquement pour les événements qui concernent un feedback précis
    # (rattachement / détachement) — jamais la clé de journalisation elle-même (issue_id).
    feedback_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("feedbacks.id", ondelete="SET NULL"), nullable=True
    )
    # Dénormalisé (via Issue.agence_id à l'écriture), même raison que HistoriqueFeedback.agence_nom.
    agence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agences.id", ondelete="CASCADE"), nullable=True
    )
    utilisateur_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    auteur_nom: Mapped[str] = mapped_column(String(200), nullable=False)
    auteur_role: Mapped[str] = mapped_column(String(50), nullable=False)
    agence_nom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    type_evenement: Mapped[str] = mapped_column(String(100), nullable=False)
    ancien_statut: Mapped[str | None] = mapped_column(String(50), nullable=True)
    nouveau_statut: Mapped[str | None] = mapped_column(String(50), nullable=True)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_evenement: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<HistoriqueIssue {self.type_evenement} issue={self.issue_id} by {self.auteur_nom}>"
