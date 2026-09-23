"""Contact agence (téléphone/email) + agence_id dénormalisé sur historique_feedbacks

Revision ID: 012_agence_contact_et_historique
Revises: 011_categorie_createur
Create Date: 2026-09-23 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '012_agence_contact_et_historique'
down_revision = '011_categorie_createur'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    agence_cols = [c["name"] for c in insp.get_columns("agences")] if "agences" in insp.get_table_names() else []
    if "telephone" not in agence_cols:
        op.add_column('agences', sa.Column('telephone', sa.String(length=30), nullable=True))
    if "email" not in agence_cols:
        op.add_column('agences', sa.Column('email', sa.String(length=255), nullable=True))

    hist_cols = (
        [c["name"] for c in insp.get_columns("historique_feedbacks")]
        if "historique_feedbacks" in insp.get_table_names() else []
    )
    if "agence_id" not in hist_cols:
        op.add_column(
            'historique_feedbacks',
            sa.Column(
                'agence_id', postgresql.UUID(as_uuid=True),
                sa.ForeignKey('agences.id', ondelete='CASCADE'), nullable=True,
            ),
        )
        # Backfill des lignes existantes via Feedback -> QRCode -> Agence.
        op.execute("""
            UPDATE historique_feedbacks hf
            SET agence_id = qc.agence_id
            FROM feedbacks f
            JOIN qr_codes qc ON qc.id = f.qr_code_id
            WHERE hf.feedback_id = f.id AND hf.agence_id IS NULL
        """)


def downgrade():
    op.drop_column('historique_feedbacks', 'agence_id')
    op.drop_column('agences', 'email')
    op.drop_column('agences', 'telephone')
