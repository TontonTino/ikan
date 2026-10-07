"""Add categories_agence.cle (stable key, system-assigned, nullable, unique per agence).

Revision ID: 025_categorie_cle
Revises: 024_organisation_secteur_code
Create Date: 2026-10-07 12:30:00

Additive et idempotente : aucune ligne existante n'est modifiée par cette migration —
`cle` reste NULL partout tant qu'aucun jeu de départ ou rattrapage ne l'a posée (voir
026_telecom_categories_rattrapage, qui ne touche que les organisations de secteur telecom).

L'unicité n'est imposée QUE par agence et QUE quand `cle` est renseignée (index unique
partiel) : deux agences peuvent partager la même clé (c'est même le but, voir
PERIMETRE_CATEGORIES dans app/services/kpi/packs_telecom.py), et une catégorie sans clé
(la grande majorité aujourd'hui) n'est jamais concernée par la contrainte.
"""
from alembic import context, op
import sqlalchemy as sa


revision = "025_categorie_cle"
down_revision = "024_organisation_secteur_code"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_categories_agence_agence_id_cle"


def upgrade():
    if context.is_offline_mode():
        op.add_column("categories_agence", sa.Column("cle", sa.String(50), nullable=True))
        op.create_index(INDEX_NAME, "categories_agence", ["agence_id", "cle"], unique=True, postgresql_where=sa.text("cle IS NOT NULL"))
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    columns = {column["name"] for column in insp.get_columns("categories_agence")}
    if "cle" not in columns:
        op.add_column("categories_agence", sa.Column("cle", sa.String(50), nullable=True))

    indexes = {index["name"] for index in insp.get_indexes("categories_agence")}
    if INDEX_NAME not in indexes:
        op.create_index(
            INDEX_NAME, "categories_agence", ["agence_id", "cle"],
            unique=True, postgresql_where=sa.text("cle IS NOT NULL"),
        )


def downgrade():
    if context.is_offline_mode():
        op.drop_index(INDEX_NAME, table_name="categories_agence")
        op.drop_column("categories_agence", "cle")
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)

    indexes = {index["name"] for index in insp.get_indexes("categories_agence")}
    if INDEX_NAME in indexes:
        op.drop_index(INDEX_NAME, table_name="categories_agence")

    columns = {column["name"] for column in insp.get_columns("categories_agence")}
    if "cle" in columns:
        op.drop_column("categories_agence", "cle")
