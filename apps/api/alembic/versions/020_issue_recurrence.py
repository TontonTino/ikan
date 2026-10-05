"""Add explicit root Issue links for recurrence occurrences.

Revision ID: 020_issue_recurrence
Revises: 019_issue_sla_deadline
Create Date: 2026-10-05 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "020_issue_recurrence"
down_revision = "019_issue_sla_deadline"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("issues", sa.Column("issue_origine_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_unique_constraint("uq_issues_organisation_id_id", "issues", ["organisation_id", "id"])
    op.create_check_constraint(
        "ck_issues_issue_origine_not_self",
        "issues",
        "issue_origine_id IS NULL OR issue_origine_id <> id",
    )
    op.create_foreign_key(
        "fk_issues_issue_origine_same_organisation",
        "issues",
        "issues",
        ["organisation_id", "issue_origine_id"],
        ["organisation_id", "id"],
        ondelete="NO ACTION",
        deferrable=True,
        initially="DEFERRED",
    )
    op.create_index("idx_issues_issue_origine_id", "issues", ["issue_origine_id"])


def downgrade():
    op.drop_index("idx_issues_issue_origine_id", table_name="issues")
    op.drop_constraint("fk_issues_issue_origine_same_organisation", "issues", type_="foreignkey")
    op.drop_constraint("ck_issues_issue_origine_not_self", "issues", type_="check")
    op.drop_constraint("uq_issues_organisation_id_id", "issues", type_="unique")
    op.drop_column("issues", "issue_origine_id")
