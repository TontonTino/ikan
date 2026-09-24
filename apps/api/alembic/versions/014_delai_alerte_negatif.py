"""Délai d'alerte des avis négatifs non traités : delai_alerte_negatif_heures (expand)

Renommage générique de delai_alerte_suggestion_heures (le délai ne concerne plus les « suggestions »
mais les avis négatifs — voir app/api/v1/endpoints/alertes.py), fait en expand/contract pour ne jamais
casser le déploiement : cette migration AJOUTE la nouvelle colonne (valeur recopiée) et laisse l'ancienne
intacte. L'ancien code, encore en ligne pendant le déploiement, continue de fonctionner. La suppression de
delai_alerte_suggestion_heures fera l'objet d'une migration ultérieure, une fois le déploiement confirmé.

Revision ID: 014_delai_alerte_negatif
Revises: 013_alertes_feedback_individuel
Create Date: 2026-09-24 00:00:00
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '014_delai_alerte_negatif'
down_revision = '013_alertes_feedback_individuel'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = [c["name"] for c in insp.get_columns("utilisateurs")] if "utilisateurs" in insp.get_table_names() else []

    if "delai_alerte_negatif_heures" not in cols:
        # server_default : l'ancien code (qui ne connaît pas cette colonne) peut encore insérer des utilisateurs.
        op.add_column(
            'utilisateurs',
            sa.Column('delai_alerte_negatif_heures', sa.Integer(), nullable=False, server_default='24'),
        )
        # Recopie des réglages déjà faits par les CX Managers (uniquement à la création de la colonne :
        # une ré-exécution ne doit jamais écraser des valeurs modifiées depuis).
        if "delai_alerte_suggestion_heures" in cols:
            op.execute("UPDATE utilisateurs SET delai_alerte_negatif_heures = delai_alerte_suggestion_heures")


def downgrade():
    # L'ancienne colonne n'a jamais été touchée : on retire seulement la nouvelle.
    op.drop_column('utilisateurs', 'delai_alerte_negatif_heures')
