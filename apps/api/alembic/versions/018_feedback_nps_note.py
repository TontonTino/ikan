"""Add optional 0-10 NPS response to feedbacks.

Revision ID: 018_feedback_nps_note
Revises: 017_agence_photo
Create Date: 2026-10-04 00:00:00
"""
from alembic import context, op
import sqlalchemy as sa


revision = "018_feedback_nps_note"
down_revision = "017_agence_photo"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "ck_feedbacks_nps_note_range"


def upgrade():
    if context.is_offline_mode():
        op.add_column("feedbacks", sa.Column("nps_note", sa.Integer(), nullable=True))
        op.create_check_constraint(
            CONSTRAINT_NAME,
            "feedbacks",
            "nps_note IS NULL OR (nps_note >= 0 AND nps_note <= 10)",
        )
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "feedbacks" not in tables:
        return

    columns = {column["name"] for column in insp.get_columns("feedbacks")}
    if "nps_note" not in columns:
        op.add_column("feedbacks", sa.Column("nps_note", sa.Integer(), nullable=True))

    constraints = {constraint["name"] for constraint in insp.get_check_constraints("feedbacks")}
    if CONSTRAINT_NAME not in constraints:
        op.create_check_constraint(
            CONSTRAINT_NAME,
            "feedbacks",
            "nps_note IS NULL OR (nps_note >= 0 AND nps_note <= 10)",
        )


def downgrade():
    if context.is_offline_mode():
        op.drop_constraint(CONSTRAINT_NAME, "feedbacks", type_="check")
        op.drop_column("feedbacks", "nps_note")
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "feedbacks" not in insp.get_table_names():
        return

    constraints = {constraint["name"] for constraint in insp.get_check_constraints("feedbacks")}
    if CONSTRAINT_NAME in constraints:
        op.drop_constraint(CONSTRAINT_NAME, "feedbacks", type_="check")

    columns = {column["name"] for column in insp.get_columns("feedbacks")}
    if "nps_note" in columns:
        op.drop_column("feedbacks", "nps_note")
