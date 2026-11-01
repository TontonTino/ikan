"""
Modèle JournalAudit — journal d'audit des actions sensibles (AD-08, SD-13, AD-03).

Table en AJOUT SEUL : aucune route ne la modifie ni ne la supprime, et sur PostgreSQL un déclencheur (migration 033) refuse tout
UPDATE, DELETE et TRUNCATE. Volontairement SANS clés étrangères : le journal doit survivre à la suppression d'un compte ou d'une
organisation (pas de cascade, pas de SET NULL qui le modifierait) ; les instantanés (e-mail de l'acteur, libellé de la cible) le
rendent lisible sans jointure. Voir app/services/journal_audit.py (service UNIQUE d'écriture) et app/api/v1/endpoints/journal.py.

Aucune donnée sensible : jamais de mot de passe, de hachage, de jeton, de contact client ni de texte d'avis.
"""
import uuid
from datetime import datetime

from sqlalchemy import DDL, JSON, CheckConstraint, DateTime, Index, String, event, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

RESULTATS = ("succes", "refus")


class JournalAudit(Base):
    __tablename__ = "journal_audit"
    __table_args__ = (
        CheckConstraint("resultat IN ('succes', 'refus')", name="ck_journal_audit_resultat"),
        Index("ix_journal_audit_date_action", "date_action", postgresql_ops={"date_action": "DESC"}),
        Index("ix_journal_audit_acteur", "acteur_id", "date_action"),
        Index("ix_journal_audit_action", "action", "date_action"),
        Index("ix_journal_audit_organisation", "organisation_id", "date_action"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    date_action: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Acteur : identifiant SANS clé étrangère + rôle + instantané de l'e-mail (compte du personnel). Anonyme : tout à NULL, rôle « anonyme ».
    acteur_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    acteur_role: Mapped[str] = mapped_column(String(30), nullable=False)
    acteur_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Code d'action STABLE (ex. « compte.cree ») : jamais un texte libre.
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    cible_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cible_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cible_libelle: Mapped[str | None] = mapped_column(String(200), nullable=True)
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    resultat: Mapped[str] = mapped_column(String(10), nullable=False)
    details: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)
    # Adresse tronquée (IPv4 en /24, IPv6 en /48) : voir services/journal_audit.tronquer_ip.
    adresse_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    def __repr__(self) -> str:
        return f"<JournalAudit {self.action} {self.resultat}>"


# Tests (SQLite) : même garantie d'ajout seul que le déclencheur PostgreSQL de la migration 033.
for _evenement in ("UPDATE", "DELETE"):
    event.listen(
        JournalAudit.__table__,
        "after_create",
        DDL(
            f"CREATE TRIGGER IF NOT EXISTS trg_journal_audit_{_evenement.lower()} BEFORE {_evenement} ON journal_audit "
            "BEGIN SELECT RAISE(ABORT, 'journal_audit est en ajout seul'); END"
        ).execute_if(dialect="sqlite"),
    )
