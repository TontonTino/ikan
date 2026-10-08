"""Add external identity and IKAN classification fields to Veille mentions.

Revision ID: 027_veille_classification
Revises: 026_telecom_categories_cle
"""
from alembic import context, op
import sqlalchemy as sa

revision = "027_veille_classification"
down_revision = "026_telecom_categories_cle"
branch_labels = None
depends_on = None

TABLE = "mentions_veille"
UNIQUE_EXTERNAL_ID = "uq_mention_veille_org_plateforme_external_id"
COLUMNS = {
    "external_id": sa.String(length=255),
    "theme_principal": sa.String(length=100),
    "theme_confidence": sa.Float(),
    "date_analyse": sa.DateTime(timezone=True),
}


def upgrade():
    if context.is_offline_mode():
        for name, column_type in COLUMNS.items():
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True))
        op.create_unique_constraint(
            UNIQUE_EXTERNAL_ID, TABLE,
            ["organisation_id", "plateforme", "external_id"],
        )
        return

    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns(TABLE)}
    for name, column_type in COLUMNS.items():
        if name not in existing_columns:
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True))

    inspector = sa.inspect(op.get_bind())
    existing_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(TABLE)}
    if UNIQUE_EXTERNAL_ID not in existing_constraints:
        op.create_unique_constraint(
            UNIQUE_EXTERNAL_ID, TABLE,
            ["organisation_id", "plateforme", "external_id"],
        )


def downgrade():
    if context.is_offline_mode():
        op.drop_constraint(UNIQUE_EXTERNAL_ID, TABLE, type_="unique")
        for name in reversed(list(COLUMNS)):
            op.drop_column(TABLE, name)
        return

    inspector = sa.inspect(op.get_bind())
    if TABLE not in inspector.get_table_names():
        return

    existing_constraints = {constraint["name"] for constraint in inspector.get_unique_constraints(TABLE)}
    if UNIQUE_EXTERNAL_ID in existing_constraints:
        op.drop_constraint(UNIQUE_EXTERNAL_ID, TABLE, type_="unique")

    existing_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns(TABLE)}
    for name in reversed(list(COLUMNS)):
        if name in existing_columns:
            op.drop_column(TABLE, name)
