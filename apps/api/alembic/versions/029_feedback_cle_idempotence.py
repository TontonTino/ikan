"""Clé d'idempotence des feedbacks soumis par le formulaire client (QR Code).

Un renvoi du même envoi (double clic, nouvelle tentative après coupure réseau) rejoue la même clé et ne crée pas de
doublon : unicité (qr_code_id, cle_idempotence), les NULL restant distincts.

⚠ ORDRE DE DÉPLOIEMENT : appliquer cette migration AVANT de déployer le code de l'API qui insère `cle_idempotence`,
sinon la soumission d'un avis échoue (colonne absente).

Revision ID: 029_feedback_cle_idempotence
Revises: 028_merge_027_veille_telecom
"""
from alembic import op

revision = "029_feedback_cle_idempotence"
down_revision = "028_merge_027_veille_telecom"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS cle_idempotence VARCHAR(64)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_feedbacks_qr_cle_idempotence "
        "ON feedbacks (qr_code_id, cle_idempotence)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS uq_feedbacks_qr_cle_idempotence")
    op.execute("ALTER TABLE feedbacks DROP COLUMN IF EXISTS cle_idempotence")
