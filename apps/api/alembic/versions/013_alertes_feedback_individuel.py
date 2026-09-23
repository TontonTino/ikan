"""Alertes individuelles par feedback : est_categorie_suggestion + délai CX Manager

Revision ID: 013_alertes_feedback_individuel
Revises: 012_agence_contact_et_historique
Create Date: 2026-09-23 00:00:00
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '013_alertes_feedback_individuel'
down_revision = '012_agence_contact_et_historique'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    cat_cols = [c["name"] for c in insp.get_columns("categories_agence")] if "categories_agence" in insp.get_table_names() else []
    if "est_categorie_suggestion" not in cat_cols:
        op.add_column(
            'categories_agence',
            sa.Column('est_categorie_suggestion', sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    user_cols = [c["name"] for c in insp.get_columns("utilisateurs")] if "utilisateurs" in insp.get_table_names() else []
    if "delai_alerte_suggestion_heures" not in user_cols:
        op.add_column(
            'utilisateurs',
            sa.Column('delai_alerte_suggestion_heures', sa.Integer(), nullable=False, server_default='24'),
        )


def downgrade():
    op.drop_column('utilisateurs', 'delai_alerte_suggestion_heures')
    op.drop_column('categories_agence', 'est_categorie_suggestion')
