"""Agence.photo — photo d'agence en base64, même principe qu'Organisation.logo (expand only)

Reproduit exactement le mécanisme déjà en place pour le logo d'organisation : une colonne
Text stockant directement le base64 de l'image, sans infrastructure de fichiers dédiée.
Additive uniquement : aucune colonne existante modifiée ou supprimée.

Idempotente sur le même modèle que les précédentes (sa.inspect() avant l'ALTER TABLE) :
app/main.py (on_startup) exécute Base.metadata.create_all() en développement, qui a donc
pu créer cette colonne avant que cette migration n'ait eu la chance de tourner.

Revision ID: 017_agence_photo
Revises: 016_issues_actions
Create Date: 2026-09-30 00:00:00
"""
from alembic import context, op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '017_agence_photo'
down_revision = '016_issues_actions'
branch_labels = None
depends_on = None


def upgrade():
    if context.is_offline_mode():
        # `alembic ... --sql` : pas de connexion réelle, donc pas d'inspection possible.
        # Génère l'ALTER TABLE complet, comme attendu sur une base neuve.
        op.add_column('agences', sa.Column('photo', sa.Text(), nullable=True))
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    colonnes = {c['name'] for c in insp.get_columns('agences')} if 'agences' in insp.get_table_names() else set()

    if 'photo' not in colonnes:
        op.add_column('agences', sa.Column('photo', sa.Text(), nullable=True))


def downgrade():
    if context.is_offline_mode():
        op.drop_column('agences', 'photo')
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'agences' not in insp.get_table_names():
        return
    colonnes = {c['name'] for c in insp.get_columns('agences')}
    if 'photo' in colonnes:
        op.drop_column('agences', 'photo')
