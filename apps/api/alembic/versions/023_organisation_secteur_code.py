"""Add Organisation.secteur_code (stable sector code) and backfill from secteur_activite.

Revision ID: 023_organisation_secteur_code
Revises: 022_drop_user_delai_suggestion
Create Date: 2026-10-07 00:00:00

Contexte (voir le rapport d'audit KPI) : `secteur_activite` est un texte libre, sans
contrainte, saisi par l'Admin. `secteur_code` devient la seule source de décision pour le
libellé affiché (app/services/secteurs.py::libelle_secteur) et pour le pack KPI du secteur
(app/services/kpi/packs.py) — `secteur_activite` et `secteur` restent en base tels quels,
non supprimés, mais ne sont plus lus pour aucune décision applicative après cette migration.

Additive et idempotente : AUCUNE colonne ni table supprimée. Logique de normalisation
dupliquée depuis app/services/secteurs.py::normaliser_secteur_libre (volontairement : une
migration ne doit pas dépendre d'un module applicatif qui peut changer après coup — elle
doit rester correcte si rejouée seule, à l'identique, dans 2 ans).

Le défaut SQL 'Télécommunications' que main.py posait jusqu'ici sur secteur_activite est
retiré ici (`ALTER COLUMN ... DROP DEFAULT`) : sans risque, cette opération ne touche
aucune ligne existante, elle change seulement ce qui se passerait sur un futur INSERT qui
omettrait la colonne (aucun chemin de code actuel ne le fait — secteur_activite est
toujours fourni explicitement par create_organisation, voir organisations.py).
"""
import unicodedata

from alembic import context, op
import sqlalchemy as sa


revision = "023_organisation_secteur_code"
down_revision = "022_drop_user_delai_suggestion"
branch_labels = None
depends_on = None

CONSTRAINT_NAME = "ck_organisations_secteur_code_valide"
SECTEUR_CODES = ("banque", "telecom", "restauration", "hotellerie", "commerce", "sante", "autre")


def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def _normaliser(valeur: str | None) -> str:
    """Copie intentionnelle de app.services.secteurs.normaliser_secteur_libre — voir la
    docstring du module pour pourquoi une migration ne doit pas importer le code applicatif."""
    if not valeur or not valeur.strip():
        return "autre"
    v = _sans_accents(valeur.strip().lower())
    if "banque" in v or "financ" in v:
        return "banque"
    if "telecom" in v:
        return "telecom"
    if "restau" in v or "maquis" in v:
        return "restauration"
    if "hotel" in v:
        return "hotellerie"
    if "commerce" in v or "distribution" in v:
        return "commerce"
    if "sante" in v or "pharmac" in v or "clinique" in v:
        return "sante"
    return "autre"


def _backfill(bind) -> None:
    organisations = sa.table(
        "organisations",
        sa.column("id"),
        sa.column("secteur_activite", sa.String),
        sa.column("secteur", sa.String),
        sa.column("secteur_code", sa.String),
    )
    rows = bind.execute(sa.select(organisations.c.id, organisations.c.secteur_activite, organisations.c.secteur)).fetchall()
    valeurs_rencontrees: dict[str | None, str] = {}
    for row in rows:
        valeur = row.secteur_activite or row.secteur
        code = _normaliser(valeur)
        valeurs_rencontrees[valeur] = code
        bind.execute(
            organisations.update().where(organisations.c.id == row.id).values(secteur_code=code)
        )
    if valeurs_rencontrees:
        print(f"[023_organisation_secteur_code] backfill secteur_activite/secteur -> secteur_code : {valeurs_rencontrees}")


def upgrade():
    if context.is_offline_mode():
        op.add_column("organisations", sa.Column("secteur_code", sa.String(30), nullable=False, server_default="autre"))
        op.create_check_constraint(CONSTRAINT_NAME, "organisations", "secteur_code IN " + str(SECTEUR_CODES))
        op.alter_column("organisations", "secteur_activite", server_default=None)
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    columns = {column["name"] for column in insp.get_columns("organisations")}
    if "secteur_code" not in columns:
        op.add_column("organisations", sa.Column("secteur_code", sa.String(30), nullable=False, server_default="autre"))

    constraints = {constraint["name"] for constraint in insp.get_check_constraints("organisations")}
    if CONSTRAINT_NAME not in constraints:
        op.create_check_constraint(CONSTRAINT_NAME, "organisations", "secteur_code IN " + str(SECTEUR_CODES))

    _backfill(bind)

    # Sans risque : ne touche aucune ligne, change seulement le comportement d'un futur
    # INSERT qui omettrait secteur_activite (aucun chemin de code actuel ne le fait).
    op.alter_column("organisations", "secteur_activite", server_default=None)


def downgrade():
    if context.is_offline_mode():
        op.drop_constraint(CONSTRAINT_NAME, "organisations", type_="check")
        op.drop_column("organisations", "secteur_code")
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)

    constraints = {constraint["name"] for constraint in insp.get_check_constraints("organisations")}
    if CONSTRAINT_NAME in constraints:
        op.drop_constraint(CONSTRAINT_NAME, "organisations", type_="check")

    columns = {column["name"] for column in insp.get_columns("organisations")}
    if "secteur_code" in columns:
        op.drop_column("organisations", "secteur_code")
