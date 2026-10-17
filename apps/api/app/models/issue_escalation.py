"""Journal structuré des escalades explicites d'une Issue."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.enums import IssueEscalationReason, UserRole


class IssueEscalation(Base):
    __tablename__ = "issue_escalations"
    __table_args__ = (
        Index("ix_issue_escalations_date_issue", "date_evenement", "issue_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    issue_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("issues.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    date_evenement: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    motif: Mapped[IssueEscalationReason] = mapped_column(
        Enum(IssueEscalationReason, name="issueescalationreason"), nullable=False
    )
    # Les escalades sont déclenchées par un utilisateur en V1 ; aucun job automatique
    # d'escalade n'existe dans le produit.
    declenchee_par_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="RESTRICT"), nullable=False
    )
    declenchee_par_nom: Mapped[str] = mapped_column(String(301), nullable=False)
    declenchee_par_role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="userrole"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<IssueEscalation issue={self.issue_id} motif={self.motif}>"
