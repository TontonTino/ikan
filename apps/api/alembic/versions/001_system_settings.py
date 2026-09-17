"""add_system_settings_table

Revision ID: 001_system_settings
Revises: b55d222757e9
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = '001_system_settings'
down_revision = 'b55d222757e9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('nom_application', sa.String(255), nullable=False, server_default='IKAN AI — Plateforme Feedback Client'),
        sa.Column('seuil_alerte_defaut', sa.Float(), nullable=False, server_default='80.0'),
        sa.Column('retention_mois', sa.Integer(), nullable=False, server_default='24'),
        sa.Column('mode_ia', sa.String(50), nullable=False, server_default='deterministique'),
        sa.Column('notifications_email_actives', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('date_modification', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('system_settings')
