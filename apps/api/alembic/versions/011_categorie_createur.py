"""Traçabilité du créateur d'une catégorie (CX Manager ou Agency Manager)

Revision ID: 011_categorie_createur
Revises: 010_logo_orange
Create Date: 2026-09-22 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '011_categorie_createur'
down_revision = '010_logo_orange'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c["name"] for c in insp.get_columns("categories_agence")] if "categories_agence" in insp.get_table_names() else []

    if "cree_par_id" not in cols:
        op.add_column(
            'categories_agence',
            sa.Column(
                'cree_par_id', postgresql.UUID(as_uuid=True),
                sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True,
            ),
        )
    if "cree_par_role" not in cols:
        # Dénormalisé (plutôt qu'une jointure) : reste correct même si l'auteur est
        # supprimé ou change de rôle plus tard. NULL = catégories créées avant cette
        # migration, toutes issues du CX Manager (seul rôle habilité à l'époque).
        op.add_column(
            'categories_agence',
            sa.Column('cree_par_role', sa.String(length=30), nullable=True),
        )
        op.execute("UPDATE categories_agence SET cree_par_role = 'cx_manager' WHERE cree_par_role IS NULL")


def downgrade():
    op.drop_column('categories_agence', 'cree_par_role')
    op.drop_column('categories_agence', 'cree_par_id')
