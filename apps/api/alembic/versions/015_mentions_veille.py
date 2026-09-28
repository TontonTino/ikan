"""Table mentions_veille — mentions réseaux sociaux séparées des feedbacks (expand only)

Les avis récupérés par le module Veille (Facebook, etc.) n'ont pas de note client réelle :
les enregistrer comme Feedback (note par défaut 3) faussait CSAT, Wilson et les alertes,
mélangés aux vrais retours QR code. Cette migration crée une table dédiée, additive
uniquement (aucune table ni colonne existante modifiée ou supprimée) : `mentions_veille`,
lue uniquement par le module Veille (endpoints /veille/mentions, /veille/synthese), jamais
par les statistiques du dashboard principal.

Revision ID: 015_mentions_veille
Revises: 014_delai_alerte_negatif
Create Date: 2026-09-28 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '015_mentions_veille'
down_revision = '014_delai_alerte_negatif'
branch_labels = None
depends_on = None


def upgrade():
    # Le type ENUM 'sentimenttype' existe déjà (table analyses_ia depuis la migration
    # initiale) : create_type=False évite un CREATE TYPE en doublon.
    sentiment_enum = postgresql.ENUM(
        'POSITIF', 'NEUTRE', 'NEGATIF', name='sentimenttype', create_type=False
    )
    op.create_table(
        'mentions_veille',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organisation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organisations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('agence_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agences.id', ondelete='SET NULL'), nullable=True),
        sa.Column('plateforme', sa.String(length=30), nullable=False, server_default='facebook'),
        sa.Column('type_contenu', sa.String(length=20), nullable=False),
        sa.Column('texte', sa.Text(), nullable=False),
        sa.Column('url_source', sa.Text(), nullable=True),
        sa.Column('date_publication', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sentiment', sentiment_enum, nullable=False),
        sa.Column('score_sentiment', sa.Float(), nullable=False),
        sa.Column('empreinte', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('organisation_id', 'empreinte', name='uq_mention_veille_organisation_empreinte'),
    )
    op.create_index('idx_mention_veille_organisation_id', 'mentions_veille', ['organisation_id'])
    op.create_index('idx_mention_veille_organisation_date', 'mentions_veille', ['organisation_id', 'date_publication'])


def downgrade():
    op.drop_index('idx_mention_veille_organisation_date', table_name='mentions_veille')
    op.drop_index('idx_mention_veille_organisation_id', table_name='mentions_veille')
    op.drop_table('mentions_veille')
