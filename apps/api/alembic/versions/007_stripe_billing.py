"""Facturation Stripe : colonnes organisations + table changements_plan

Revision ID: 007_stripe_billing
Revises: 006_plans_forfaits
Create Date: 2026-09-20 00:00:00
"""
from alembic import op

from app.services.stripe_billing_bootstrap import appliquer_schema_stripe

# revision identifiers, used by Alembic.
revision = '007_stripe_billing'
down_revision = '006_plans_forfaits'
branch_labels = None
depends_on = None


def upgrade():
    # SQL idempotent, partagé avec le filet de démarrage (app/main.py).
    appliquer_schema_stripe(op.get_bind())


def downgrade():
    op.execute("DROP TABLE IF EXISTS changements_plan")
    op.execute("ALTER TABLE organisations DROP COLUMN IF EXISTS payment_failed_at")
    op.execute("ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_subscription_status")
    op.execute("ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_subscription_id")
    op.execute("ALTER TABLE organisations DROP COLUMN IF EXISTS stripe_customer_id")
