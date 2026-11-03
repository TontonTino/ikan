"""
Modèle AlerteEpisode — un dépassement du seuil de satisfaction d'une agence, du début à la fin (cycle de vie des alertes, PR 2/5).

Les alertes de seuil restent CALCULÉES à chaque lecture de GET /alertes/ ; cette table n'en garde que la mémoire : un épisode s'ouvre quand la
condition devient vraie, se termine quand les données montrent qu'elle ne l'est plus (cause de fin enregistrée), et un retour du problème ouvre un
NOUVEL épisode (l'ancien reste). Écrite uniquement par app/services/alertes_episodes.py. Migration 034.

`debut_condition` (reconstitué d'après les avis, toujours approximatif) et `detecte_le` (première constatation par IKAN) sont deux dates distinctes,
jamais confondues. Toutes les dates sont en UTC avec fuseau.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, String, text, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

TYPE_SEUIL_SATISFACTION = "seuil_satisfaction"
STATUT_DETECTEE = "detectee"
STATUT_PRISE_EN_CHARGE = "prise_en_charge"
STATUT_TERMINEE = "terminee"
STATUTS = (STATUT_DETECTEE, STATUT_PRISE_EN_CHARGE, STATUT_TERMINEE)

FIN_RETABLIE = "retablie"
FIN_DONNEES_INSUFFISANTES = "donnees_insuffisantes"
FIN_SEUIL_MODIFIE = "seuil_modifie"
FIN_AGENCE_DESACTIVEE = "agence_desactivee"
CAUSES_FIN = (FIN_RETABLIE, FIN_DONNEES_INSUFFISANTES, FIN_SEUIL_MODIFIE, FIN_AGENCE_DESACTIVEE)

_NON_TERMINE = "statut <> 'terminee'"


class AlerteEpisode(Base):
    __tablename__ = "alerte_episodes"
    __table_args__ = (
        CheckConstraint("type IN ('seuil_satisfaction')", name="ck_alerte_episodes_type"),
        CheckConstraint("statut IN ('detectee', 'prise_en_charge', 'terminee')", name="ck_alerte_episodes_statut"),
        CheckConstraint(
            "fin_cause IS NULL OR fin_cause IN ('retablie', 'donnees_insuffisantes', 'seuil_modifie', 'agence_desactivee')",
            name="ck_alerte_episodes_fin_cause",
        ),
        CheckConstraint(
            "(statut = 'terminee' AND terminee_le IS NOT NULL AND fin_cause IS NOT NULL AND fin_condition IS NOT NULL) "
            "OR (statut <> 'terminee' AND terminee_le IS NULL AND fin_cause IS NULL AND fin_condition IS NULL)",
            name="ck_alerte_episodes_terminee",
        ),
        CheckConstraint(
            "(statut <> 'detectee' OR pris_en_charge_le IS NULL) AND (statut <> 'prise_en_charge' OR pris_en_charge_le IS NOT NULL)",
            name="ck_alerte_episodes_prise_en_charge",
        ),
        CheckConstraint("fin_condition IS NULL OR fin_condition >= debut_condition", name="ck_alerte_episodes_fin_apres_debut"),
        # UN SEUL épisode non terminé par agence et par type : garanti par la base, pas seulement par le code.
        Index("uq_alerte_episode_ouvert", "agence_id", "type", unique=True, postgresql_where=text(_NON_TERMINE), sqlite_where=text(_NON_TERMINE)),
        Index("ix_alerte_episodes_agence_debut", "agence_id", "debut_condition", postgresql_ops={"debut_condition": "DESC"}),
        Index("ix_alerte_episodes_organisation_debut", "organisation_id", "debut_condition", postgresql_ops={"debut_condition": "DESC"}),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organisation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False)
    agence_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("agences.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False, default=TYPE_SEUIL_SATISFACTION, server_default=TYPE_SEUIL_SATISFACTION)
    statut: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUT_DETECTEE, server_default=STATUT_DETECTEE)

    debut_condition: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    debut_approximatif: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    debut_remontee_limitee: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    detecte_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    taux_ouverture: Mapped[float] = mapped_column(Float, nullable=False)
    seuil_ouverture: Mapped[float] = mapped_column(Float, nullable=False)
    gravite_ouverture: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Prise en charge : écrite par une PR ultérieure (Agency Manager uniquement). Colonnes prévues dès maintenant : une seule migration.
    pris_en_charge_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pris_en_charge_par_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("utilisateurs.id", ondelete="SET NULL"), nullable=True)
    pris_en_charge_par_nom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    commentaire_prise_en_charge: Mapped[str | None] = mapped_column(String(500), nullable=True)

    fin_condition: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    terminee_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fin_cause: Mapped[str | None] = mapped_column(String(30), nullable=True)
    taux_fermeture: Mapped[float | None] = mapped_column(Float, nullable=True)
    seuil_fermeture: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    def __repr__(self) -> str:
        return f"<AlerteEpisode {self.type} {self.statut} agence={self.agence_id}>"
