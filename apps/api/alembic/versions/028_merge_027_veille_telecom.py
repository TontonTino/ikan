"""Merge the concurrent Veille and telecom retry revisions.

Revision ID: 028_merge_027_veille_telecom
Revises: 027_veille_classification, 027_telecom_cles_retry
"""

from alembic import op

revision = "028_merge_027_veille_telecom"
down_revision = ("027_veille_classification", "027_telecom_cles_retry")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
