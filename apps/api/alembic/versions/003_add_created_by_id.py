"""add_created_by_id

Revision ID: 003_add_created_by_id
Revises: 002_organisation_fields
Create Date: 2026-08-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '003_add_created_by_id'
down_revision = '002_organisation_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Ajouter created_by_id à organisations si manquante
    try:
        op.add_column(
            'organisations',
            sa.Column('created_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True)
        )
    except Exception:
        pass

    # 2. Ajouter created_by_id à utilisateurs si manquante
    try:
        op.add_column(
            'utilisateurs',
            sa.Column('created_by_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True)
        )
    except Exception:
        pass


def downgrade() -> None:
    try:
        op.drop_column('utilisateurs', 'created_by_id')
    except Exception:
        pass
    try:
        op.drop_column('organisations', 'created_by_id')
    except Exception:
        pass
