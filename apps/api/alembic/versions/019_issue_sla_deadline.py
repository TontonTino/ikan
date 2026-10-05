"""Add an optional absolute SLA deadline to Issues.

Revision ID: 019_issue_sla_deadline
Revises: 018_feedback_nps_note
Create Date: 2026-10-05 00:00:00
"""
from alembic import op
import sqlalchemy as sa


revision = "019_issue_sla_deadline"
down_revision = "018_feedback_nps_note"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("issues", sa.Column("date_limite_sla", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("issues", "date_limite_sla")
