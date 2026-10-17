"""Create the explicit Issue escalation journal.

Revision ID: 023_issue_escalations
Revises: 022_drop_user_delai_suggestion
Create Date: 2026-10-06 00:00:02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "023_issue_escalations"
down_revision = "022_drop_user_delai_suggestion"
branch_labels = None
depends_on = None


issue_escalation_reason = postgresql.ENUM(
    "SLA", "CRITICITE", "RISQUE_CLIENT", "DECISION_MANAGERIALE", "AUTRE",
    name="issueescalationreason", create_type=False,
)
user_role = postgresql.ENUM(
    "ADMIN", "CX_MANAGER", "AGENCY_MANAGER", name="userrole", create_type=False
)


def upgrade():
    bind = op.get_bind()
    issue_escalation_reason.create(bind, checkfirst=True)
    op.create_table(
        "issue_escalations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "issue_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("issues.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("date_evenement", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("motif", issue_escalation_reason, nullable=False),
        sa.Column(
            "declenchee_par_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("utilisateurs.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("declenchee_par_nom", sa.String(length=301), nullable=False),
        sa.Column("declenchee_par_role", user_role, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_issue_escalations_issue_id", "issue_escalations", ["issue_id"])
    op.create_index(
        "ix_issue_escalations_date_issue", "issue_escalations", ["date_evenement", "issue_id"]
    )


def downgrade():
    op.drop_index("ix_issue_escalations_date_issue", table_name="issue_escalations")
    op.drop_index("ix_issue_escalations_issue_id", table_name="issue_escalations")
    op.drop_table("issue_escalations")
    issue_escalation_reason.drop(op.get_bind(), checkfirst=True)
