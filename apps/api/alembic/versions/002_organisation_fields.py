"""update_organisation_fields

Revision ID: 002_organisation_fields
Revises: 001_system_settings
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '002_organisation_fields'
down_revision = '001_system_settings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Rendre les anciennes colonnes nullable si elles existent pour éviter les violations NOT NULL
    try:
        op.alter_column('organisations', 'secteur', nullable=True)
    except Exception:
        pass

    try:
        op.alter_column('organisations', 'email', nullable=True)
    except Exception:
        pass

    try:
        op.alter_column('organisations', 'date_creation', nullable=True)
    except Exception:
        pass

    # 2. Rendre la colonne logo en TEXT pour supporter les images Base64
    try:
        op.alter_column('organisations', 'logo', type_=sa.Text(), existing_type=sa.String(500), nullable=True)
    except Exception:
        pass
    try:
        op.add_column('organisations', sa.Column('logo', sa.Text(), nullable=True))
    except Exception:
        pass

    # 3. Ajouter secteur_activite
    op.add_column('organisations', sa.Column('secteur_activite', sa.String(length=100), nullable=True))
    op.execute("UPDATE organisations SET secteur_activite = secteur WHERE secteur_activite IS NULL AND secteur IS NOT NULL;")
    op.execute("UPDATE organisations SET secteur_activite = 'Télécommunications' WHERE secteur_activite IS NULL;")
    op.alter_column('organisations', 'secteur_activite', nullable=False, server_default='Télécommunications')

    # 4. Ajouter pays_region
    op.add_column('organisations', sa.Column('pays_region', sa.String(length=100), nullable=True))
    op.execute("UPDATE organisations SET pays_region = 'Tunisie / Afrique du Nord' WHERE pays_region IS NULL;")
    op.alter_column('organisations', 'pays_region', nullable=False, server_default='Tunisie / Afrique du Nord')

    # 5. Ajouter email_pro
    op.add_column('organisations', sa.Column('email_pro', sa.String(length=255), nullable=True))
    op.execute("UPDATE organisations SET email_pro = email WHERE email_pro IS NULL AND email IS NOT NULL;")
    op.execute("UPDATE organisations SET email_pro = 'contact@orange.tn' WHERE email_pro IS NULL;")
    op.alter_column('organisations', 'email_pro', nullable=False)
    
    try:
        op.create_index(op.f('ix_organisations_email_pro'), 'organisations', ['email_pro'], unique=True)
    except Exception:
        pass

    # 6. Ajouter created_at
    op.add_column('organisations', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True))
    op.execute("UPDATE organisations SET created_at = date_creation WHERE created_at IS NULL AND date_creation IS NOT NULL;")
    op.execute("UPDATE organisations SET created_at = NOW() WHERE created_at IS NULL;")
    op.alter_column('organisations', 'created_at', nullable=False)


def downgrade() -> None:
    pass
