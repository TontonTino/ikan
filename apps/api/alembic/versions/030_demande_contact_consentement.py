"""Consentement à être recontacté : colonnes additives sur demandes_contact.

Trois colonnes NULLABLES (aucune valeur imposée aux lignes existantes, aucune donnée modifiée) :
consentement_contact, consentement_date, consentement_retention_mois (durée affichée au client au moment du
consentement). Idempotent (IF NOT EXISTS), comme les migrations précédentes.

⚠ ORDRE DE DÉPLOIEMENT : appliquer cette migration AVANT de déployer le code de l'API qui écrit ces colonnes
(render.yaml l'applique au démarrage via `alembic upgrade head`).

Revision ID: 030_demande_contact_consentement
Revises: 029_feedback_cle_idempotence
"""
from alembic import op

revision = "030_demande_contact_consentement"
down_revision = "029_feedback_cle_idempotence"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE demandes_contact ADD COLUMN IF NOT EXISTS consentement_contact BOOLEAN")
    op.execute("ALTER TABLE demandes_contact ADD COLUMN IF NOT EXISTS consentement_date TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE demandes_contact ADD COLUMN IF NOT EXISTS consentement_retention_mois INTEGER")


def downgrade():
    op.execute("ALTER TABLE demandes_contact DROP COLUMN IF EXISTS consentement_retention_mois")
    op.execute("ALTER TABLE demandes_contact DROP COLUMN IF EXISTS consentement_date")
    op.execute("ALTER TABLE demandes_contact DROP COLUMN IF EXISTS consentement_contact")
