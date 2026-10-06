"""Suppression de organisations.telephone (colonne jamais utilisée par le code).

DESTRUCTIVE là où la colonne existe : les numéros éventuellement saisis dans
organisations.telephone sont perdus. Le téléphone de contact vit sur agences,
demandes_contact et feedbacks, qui ne sont pas touchés.

Idempotente : ne fait rien si la colonne est absente (cas d'une base créée avant
la migration init). Le downgrade recrée la colonne nullable, vide.

Revision ID: 021_drop_org_telephone
Revises: 020_issue_recurrence
Create Date: 2026-10-06 00:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = "021_drop_org_telephone"
down_revision = "020_issue_recurrence"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("organisations")]
    if "telephone" in cols:
        op.drop_column("organisations", "telephone")


def downgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("organisations")]
    if "telephone" not in cols:
        op.add_column("organisations", sa.Column("telephone", sa.String(length=30), nullable=True))
