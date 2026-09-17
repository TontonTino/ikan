"""Feedback workflow Closed-Loop, audit history, and customer responses

Revision ID: 004_feedback_workflow
Revises: 003_add_created_by_id
Create Date: 2026-09-04 18:16:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '004_feedback_workflow'
down_revision = '003_add_created_by_id'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_tables = insp.get_table_names()
    feedback_cols = [c["name"] for c in insp.get_columns("feedbacks")] if "feedbacks" in existing_tables else []

    # 1. Colonnes feedbacks
    if "statut_traitement" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('statut_traitement', sa.String(length=50), server_default='nouveau', nullable=False))
    if "assigne_a_id" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('assigne_a_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True))
    if "action_a_prendre" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('action_a_prendre', sa.Text(), nullable=True))
    if "action_realisee" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('action_realisee', sa.Boolean(), server_default='false', nullable=False))
    if "date_assignation" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('date_assignation', sa.DateTime(timezone=True), nullable=True))
    if "date_resolution" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('date_resolution', sa.DateTime(timezone=True), nullable=True))
    if "suggestion_agence" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('suggestion_agence', sa.Text(), nullable=True))
    if "suggestion_agence_auteur" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('suggestion_agence_auteur', sa.String(length=200), nullable=True))
    if "suggestion_agence_date" not in feedback_cols:
        op.add_column('feedbacks', sa.Column('suggestion_agence_date', sa.DateTime(timezone=True), nullable=True))

    # 2. Table historique_feedbacks
    if 'historique_feedbacks' not in existing_tables:
        op.create_table(
            'historique_feedbacks',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('feedback_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('feedbacks.id', ondelete='CASCADE'), nullable=False),
            sa.Column('utilisateur_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True),
            sa.Column('auteur_nom', sa.String(length=200), nullable=False),
            sa.Column('auteur_role', sa.String(length=50), nullable=False),
            sa.Column('agence_nom', sa.String(length=200), nullable=True),
            sa.Column('type_evenement', sa.String(length=100), nullable=False),
            sa.Column('ancien_statut', sa.String(length=50), nullable=True),
            sa.Column('nouveau_statut', sa.String(length=50), nullable=True),
            sa.Column('details', sa.Text(), nullable=True),
            sa.Column('date_evenement', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index('idx_hist_feedback_id', 'historique_feedbacks', ['feedback_id'])
        op.create_index('idx_hist_date_evenement', 'historique_feedbacks', ['date_evenement'])

    # 3. Table reponses_clients
    if 'reponses_clients' not in existing_tables:
        op.create_table(
            'reponses_clients',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('feedback_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('feedbacks.id', ondelete='CASCADE'), nullable=False),
            sa.Column('utilisateur_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True),
            sa.Column('auteur_nom', sa.String(length=200), nullable=False),
            sa.Column('auteur_role', sa.String(length=50), nullable=False),
            sa.Column('canal', sa.String(length=50), server_default='telephone', nullable=False),
            sa.Column('contenu', sa.Text(), nullable=False),
            sa.Column('date_envoi', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index('idx_reponses_feedback_id', 'reponses_clients', ['feedback_id'])


def downgrade():
    op.drop_table('reponses_clients')
    op.drop_table('historique_feedbacks')
    op.drop_column('feedbacks', 'suggestion_agence_date')
    op.drop_column('feedbacks', 'suggestion_agence_auteur')
    op.drop_column('feedbacks', 'suggestion_agence')
    op.drop_column('feedbacks', 'date_resolution')
    op.drop_column('feedbacks', 'date_assignation')
    op.drop_column('feedbacks', 'action_realisee')
    op.drop_column('feedbacks', 'action_a_prendre')
    op.drop_column('feedbacks', 'assigne_a_id')
    op.drop_column('feedbacks', 'statut_traitement')
