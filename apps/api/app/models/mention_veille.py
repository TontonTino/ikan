"""
Modèle MentionVeille — mention réseaux sociaux (Facebook, etc.) collectée par le
module Veille. Table séparée de Feedback : ces avis n'ont pas de note client réelle
(la note par défaut 3 auparavant utilisée faussait CSAT, Wilson et les alertes) et ne
doivent jamais être mélangés aux retours du QR code. Lue uniquement par le module
Veille (endpoints /veille/mentions, /veille/synthese) — jamais par les statistiques
du dashboard principal.

Volontairement absent : toute identité de l'auteur (nom, identifiant, profil), même
si le microservice de scraping la renvoie — voir ingest_mentions (veille_service.py).
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Text, DateTime, Float, ForeignKey, Enum, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.enums import SentimentType


class MentionVeille(Base):
    __tablename__ = "mentions_veille"
    __table_args__ = (
        UniqueConstraint("organisation_id", "empreinte", name="uq_mention_veille_organisation_empreinte"),
        Index("idx_mention_veille_organisation_date", "organisation_id", "date_publication"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Une mention peut concerner l'organisation en général (page Facebook du réseau), sans agence précise.
    agence_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("agences.id", ondelete="SET NULL"), nullable=True
    )
    plateforme: Mapped[str] = mapped_column(String(30), nullable=False, default="facebook", server_default="facebook")
    type_contenu: Mapped[str] = mapped_column(String(20), nullable=False)  # "publication" | "commentaire" | "avis"
    texte: Mapped[str] = mapped_column(Text, nullable=False)  # tronqué à 2000 caractères avant insertion
    url_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_publication: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sentiment: Mapped[SentimentType] = mapped_column(Enum(SentimentType), nullable=False)
    score_sentiment: Mapped[float] = mapped_column(Float, nullable=False)
    # sha256(plateforme + texte normalisé (minuscules, espaces réduits) + date_publication + url_source) :
    # détecte les ré-extractions du même contenu pour une organisation, sans jamais stocker l'auteur.
    empreinte: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self) -> str:
        return f"<MentionVeille plateforme={self.plateforme} sentiment={self.sentiment} org={self.organisation_id}>"
