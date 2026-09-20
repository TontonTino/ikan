"""Idempotence webhook Stripe : table stripe_events_traites

Revision ID: 008_stripe_webhook_events
Revises: 007_stripe_billing
Create Date: 2026-09-21 00:00:00
"""
from alembic import op

from app.services.stripe_billing_bootstrap import appliquer_schema_webhook_events

# revision identifiers, used by Alembic.
revision = '008_stripe_webhook_events'
down_revision = '007_stripe_billing'
branch_labels = None
depends_on = None


def upgrade():
    # SQL idempotent, partagé avec le filet de démarrage (app/main.py).
    appliquer_schema_webhook_events(op.get_bind())


def downgrade():
    op.execute("DROP TABLE IF EXISTS stripe_events_traites")
