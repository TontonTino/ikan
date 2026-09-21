"""Alertes de quota par email : table alertes_quota_envoyees

Revision ID: 009_alertes_quota
Revises: 008_stripe_webhook_events
Create Date: 2026-09-21 00:00:00
"""
from alembic import op

from app.services.quota_alert_bootstrap import appliquer_schema_alertes_quota

# revision identifiers, used by Alembic.
revision = '009_alertes_quota'
down_revision = '008_stripe_webhook_events'
branch_labels = None
depends_on = None


def upgrade():
    # SQL idempotent, partagé avec le filet de démarrage (app/main.py).
    appliquer_schema_alertes_quota(op.get_bind())


def downgrade():
    op.execute("DROP TABLE IF EXISTS alertes_quota_envoyees")
