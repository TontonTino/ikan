"""
Modèle Feedback — avis soumis par un client anonyme via QR Code.
Le feedback est anonyme et accessible uniquement après le scan du QR Code.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    qr_code_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("qr_codes.id", ondelete="CASCADE"), nullable=False
    )
    # Note de satisfaction (1 à 5 étoiles)
    note: Mapped[int] = mapped_column(Integer, nullable=False)
    # Commentaire libre (max 1000 caractères — BF-03)
    commentaire: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    date_soumission: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Workflow de traitement Closed-Loop
    statut_traitement: Mapped[str] = mapped_column(
        String(50), nullable=False, default="nouveau"
    )
    assigne_a_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True
    )
    action_a_prendre: Mapped[str | None] = mapped_column(Text, nullable=True)
    action_realisee: Mapped[bool] = mapped_column(default=False)
    date_assignation: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    date_resolution: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    suggestion_agence: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggestion_agence_auteur: Mapped[str | None] = mapped_column(String(200), nullable=True)
    suggestion_agence_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relations
    qr_code: Mapped["QRCode"] = relationship("QRCode", back_populates="feedbacks")
    assigne_a: Mapped["Utilisateur | None"] = relationship(
        "Utilisateur", foreign_keys=[assigne_a_id]
    )
    suggestion: Mapped["Suggestion | None"] = relationship(
        "Suggestion", back_populates="feedback", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    analyse_ia: Mapped["AnalyseIA | None"] = relationship(
        "AnalyseIA", back_populates="feedback", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    demande_contact: Mapped["DemandeContact | None"] = relationship(
        "DemandeContact", back_populates="feedback", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )
    historique_evenements: Mapped[list["HistoriqueFeedback"]] = relationship(
        "HistoriqueFeedback", back_populates="feedback", cascade="all, delete-orphan", passive_deletes=True,
        order_by="HistoriqueFeedback.date_evenement.desc()"
    )
    reponses_client: Mapped[list["ReponseClient"]] = relationship(
        "ReponseClient", back_populates="feedback", cascade="all, delete-orphan", passive_deletes=True,
        order_by="ReponseClient.date_envoi.asc()"
    )

    def __repr__(self) -> str:
        return f"<Feedback note={self.note} statut={self.statut_traitement} qr={self.qr_code_id}>"

