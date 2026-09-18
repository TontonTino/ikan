"""Categories per agence (CX Manager defined), replaces AI theme guessing

Revision ID: 005_categories_agence
Revises: 004_feedback_workflow
Create Date: 2026-09-18 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '005_categories_agence'
down_revision = '004_feedback_workflow'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_tables = insp.get_table_names()

    if 'categories_agence' not in existing_tables:
        op.create_table(
            'categories_agence',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('agence_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agences.id', ondelete='CASCADE'), nullable=False),
            sa.Column('nom', sa.String(length=100), nullable=False),
            sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index('idx_categorie_agence_id', 'categories_agence', ['agence_id'])

    feedback_cols = [c["name"] for c in insp.get_columns("feedbacks")] if "feedbacks" in existing_tables else []
    if "categorie_id" not in feedback_cols:
        op.add_column(
            'feedbacks',
            sa.Column('categorie_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('categories_agence.id', ondelete='SET NULL'), nullable=True),
        )
        op.create_index('idx_feedback_categorie_id', 'feedbacks', ['categorie_id'])


def downgrade():
    op.drop_index('idx_feedback_categorie_id', table_name='feedbacks')
    op.drop_column('feedbacks', 'categorie_id')
    op.drop_index('idx_categorie_agence_id', table_name='categories_agence')
    op.drop_table('categories_agence')
