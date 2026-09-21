"""Logo officiel Orange pour l'organisation « Orange Burkina Faso »

Revision ID: 010_logo_orange
Revises: 009_alertes_quota
"""
from alembic import op

revision = '010_logo_orange'
down_revision = '009_alertes_quota'
branch_labels = None
depends_on = None

LOGO = '/org-logos/orange.png'


def upgrade() -> None:
    # Uniquement Orange, et sans écraser un logo déjà configuré.
    op.execute(
        f"UPDATE organisations SET logo = '{LOGO}' WHERE nom = 'Orange Burkina Faso' AND logo IS NULL"
    )


def downgrade() -> None:
    op.execute(f"UPDATE organisations SET logo = NULL WHERE nom = 'Orange Burkina Faso' AND logo = '{LOGO}'")
