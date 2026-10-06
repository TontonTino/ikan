"""Contract : suppression de utilisateurs.delai_alerte_suggestion_heures.

Étape « contract » du renommage expand/contract amorcé en 013/014 : la valeur a
été reprise dans delai_alerte_negatif_heures. Le dashboard et le backend ne lisent
plus l'ancienne colonne.

DESTRUCTIVE : la colonne et ses valeurs sont supprimées. L'upgrade commence par un
rattrapage sans perte (copie dans delai_alerte_negatif_heures là où cette dernière
est NULL). Le downgrade recrée la colonne (défaut 24) et y recopie les valeurs de
delai_alerte_negatif_heures : les valeurs de l'ancienne colonne ne sont pas
restaurées à l'identique, seulement reconstruites.

Idempotente : ne fait rien si la colonne est absente.

Revision ID: 022_drop_user_delai_suggestion
Revises: 021_drop_org_telephone
Create Date: 2026-10-06 00:00:01
"""
from alembic import op
import sqlalchemy as sa


revision = "022_drop_user_delai_suggestion"
down_revision = "021_drop_org_telephone"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("utilisateurs")]
    if "delai_alerte_suggestion_heures" not in cols:
        return
    # Rattrapage sans perte : ne touche jamais une valeur déjà renseignée dans la nouvelle colonne.
    op.execute(
        "UPDATE utilisateurs SET delai_alerte_negatif_heures = delai_alerte_suggestion_heures "
        "WHERE delai_alerte_negatif_heures IS NULL AND delai_alerte_suggestion_heures IS NOT NULL"
    )
    op.drop_column("utilisateurs", "delai_alerte_suggestion_heures")


def downgrade():
    insp = sa.inspect(op.get_bind())
    cols = [c["name"] for c in insp.get_columns("utilisateurs")]
    if "delai_alerte_suggestion_heures" not in cols:
        op.add_column(
            "utilisateurs",
            sa.Column("delai_alerte_suggestion_heures", sa.Integer(), nullable=False, server_default="24"),
        )
    op.execute("UPDATE utilisateurs SET delai_alerte_suggestion_heures = delai_alerte_negatif_heures")
