"""Forfaits : tables plans / plan_features et organisations.plan_id

Revision ID: 006_plans_forfaits
Revises: 005_categories_agence
Create Date: 2026-09-18 00:00:00
"""
from alembic import op

from app.services.plan_bootstrap import appliquer_schema_plans

# revision identifiers, used by Alembic.
revision = '006_plans_forfaits'
down_revision = '005_categories_agence'
branch_labels = None
depends_on = None


def upgrade():
    # SQL idempotent, partagé avec le filet de démarrage (app/main.py).
    appliquer_schema_plans(op.get_bind())


def downgrade():
    op.execute("ALTER TABLE organisations DROP COLUMN IF EXISTS plan_id")
    op.execute("DROP TABLE IF EXISTS plan_features")
    op.execute("DROP TABLE IF EXISTS plans")
