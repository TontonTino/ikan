"""Table mentions_veille — mentions réseaux sociaux séparées des feedbacks (expand only)

Les avis récupérés par le module Veille (Facebook, etc.) n'ont pas de note client réelle :
les enregistrer comme Feedback (note par défaut 3) faussait CSAT, Wilson et les alertes,
mélangés aux vrais retours QR code. Cette migration crée une table dédiée, additive
uniquement (aucune table ni colonne existante modifiée ou supprimée) : `mentions_veille`,
lue uniquement par le module Veille (endpoints /veille/mentions, /veille/synthese), jamais
par les statistiques du dashboard principal.

Idempotente (table/index/contrainte créés seulement s'ils manquent) : app/main.py
(on_startup) exécute Base.metadata.create_all() à chaque démarrage de l'API, et un
démarrage local pointant sur la même base que Render a donc pu créer cette table avant
que cette migration n'ait eu la chance de tourner — sans quoi `alembic upgrade` échoue
sur "relation mentions_veille already exists" au déploiement suivant.

Revision ID: 015_mentions_veille
Revises: 014_delai_alerte_negatif
Create Date: 2026-09-28 00:00:00
"""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '015_mentions_veille'
down_revision = '014_delai_alerte_negatif'
branch_labels = None
depends_on = None

INDEX_ORGANISATION_ID = 'idx_mention_veille_organisation_id'
INDEX_ORGANISATION_DATE = 'idx_mention_veille_organisation_date'
CONTRAINTE_UNIQUE = 'uq_mention_veille_organisation_empreinte'


def _create_table():
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
        sa.UniqueConstraint('organisation_id', 'empreinte', name=CONTRAINTE_UNIQUE),
    )


def upgrade():
    if context.is_offline_mode():
        # `alembic ... --sql` : pas de connexion réelle, donc pas d'inspection possible.
        # Génère la création complète, comme attendu sur une base neuve.
        _create_table()
        op.create_index(INDEX_ORGANISATION_ID, 'mentions_veille', ['organisation_id'])
        op.create_index(INDEX_ORGANISATION_DATE, 'mentions_veille', ['organisation_id', 'date_publication'])
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    table_existante = 'mentions_veille' in insp.get_table_names()

    if not table_existante:
        _create_table()
        insp = sa.inspect(bind)  # rafraîchi : la table vient d'apparaître

    index_existants = {idx['name'] for idx in insp.get_indexes('mentions_veille')}
    if INDEX_ORGANISATION_ID not in index_existants:
        op.create_index(INDEX_ORGANISATION_ID, 'mentions_veille', ['organisation_id'])
    if INDEX_ORGANISATION_DATE not in index_existants:
        op.create_index(INDEX_ORGANISATION_DATE, 'mentions_veille', ['organisation_id', 'date_publication'])

    contraintes_existantes = {c['name'] for c in insp.get_unique_constraints('mentions_veille')}
    if CONTRAINTE_UNIQUE not in contraintes_existantes:
        op.create_unique_constraint(CONTRAINTE_UNIQUE, 'mentions_veille', ['organisation_id', 'empreinte'])


def downgrade():
    if context.is_offline_mode():
        op.drop_index(INDEX_ORGANISATION_DATE, table_name='mentions_veille')
        op.drop_index(INDEX_ORGANISATION_ID, table_name='mentions_veille')
        op.drop_table('mentions_veille')
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'mentions_veille' not in insp.get_table_names():
        return

    index_existants = {idx['name'] for idx in insp.get_indexes('mentions_veille')}
    if INDEX_ORGANISATION_DATE in index_existants:
        op.drop_index(INDEX_ORGANISATION_DATE, table_name='mentions_veille')
    if INDEX_ORGANISATION_ID in index_existants:
        op.drop_index(INDEX_ORGANISATION_ID, table_name='mentions_veille')
    op.drop_table('mentions_veille')
