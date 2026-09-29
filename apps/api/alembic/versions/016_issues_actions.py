"""Tables issues, actions_correctives, historique_issues + feedbacks.issue_id (expand only)

Fondation V1 de la fonctionnalité Issue : distingue un problème réel (potentiellement
signalé par plusieurs feedbacks) d'un feedback individuel. V1 volontairement manuelle
(un CX Manager ou Agency Manager crée l'Issue et y rattache des feedbacks à la main) —
pas de suggestion IA de regroupement, pas de clustering, pas de dashboard ni de KPI dédiés.
Additive uniquement : aucune table ni colonne existante modifiée ou supprimée.

Idempotente sur le même modèle que 015_mentions_veille (sa.inspect() avant chaque
création) : app/main.py (on_startup) exécute Base.metadata.create_all() en développement,
qui a donc pu créer ces tables avant que cette migration n'ait eu la chance de tourner.

Revision ID: 016_issues_actions
Revises: 015_mentions_veille
Create Date: 2026-09-29 00:00:00
"""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '016_issues_actions'
down_revision = '015_mentions_veille'
branch_labels = None
depends_on = None

INDEX_ISSUES_ORGANISATION_ID = 'idx_issues_organisation_id'
INDEX_ISSUES_AGENCE_STATUT = 'idx_issues_agence_id_statut'
INDEX_ACTIONS_ISSUE_ID = 'idx_actions_correctives_issue_id'
INDEX_HISTORIQUE_ISSUE_ID = 'idx_historique_issues_issue_id'
INDEX_FEEDBACKS_ISSUE_ID = 'idx_feedbacks_issue_id'


def _create_issues_table():
    # Le type ENUM 'criticitetype' existe déjà (table analyses_ia depuis la migration
    # initiale) : create_type=False évite un CREATE TYPE en doublon.
    criticite_enum = postgresql.ENUM(
        'FAIBLE', 'MOYENNE', 'ELEVEE', 'CRITIQUE', name='criticitetype', create_type=False
    )
    op.create_table(
        'issues',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organisation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organisations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('agence_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agences.id', ondelete='CASCADE'), nullable=False),
        sa.Column('titre', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('statut', sa.String(length=30), nullable=False, server_default='ouverte'),
        sa.Column('severite', criticite_enum, nullable=False, server_default='FAIBLE'),
        sa.Column('categorie_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('categories_agence.id', ondelete='SET NULL'), nullable=True),
        sa.Column('theme_principal', sa.String(length=100), nullable=True),
        sa.Column('necessite_action', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('premiere_detection', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('derniere_detection', sa.DateTime(timezone=True), nullable=True),
        sa.Column('date_resolution', sa.DateTime(timezone=True), nullable=True),
        sa.Column('date_verification', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def _create_actions_correctives_table():
    op.create_table(
        'actions_correctives',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('issue_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('issues.id', ondelete='CASCADE'), nullable=False),
        sa.Column('titre', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('statut', sa.String(length=30), nullable=False, server_default='creee'),
        sa.Column('responsable_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('utilisateurs.id', ondelete='SET NULL'), nullable=True),
        sa.Column('echeance', sa.DateTime(timezone=True), nullable=True),
        sa.Column('date_completion', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def _create_historique_issues_table():
    op.create_table(
        'historique_issues',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('issue_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('issues.id', ondelete='CASCADE'), nullable=False),
        sa.Column('feedback_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('feedbacks.id', ondelete='SET NULL'), nullable=True),
        sa.Column('agence_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('agences.id', ondelete='CASCADE'), nullable=True),
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


def upgrade():
    if context.is_offline_mode():
        # `alembic ... --sql` : pas de connexion réelle, donc pas d'inspection possible.
        # Génère la création complète, comme attendu sur une base neuve.
        _create_issues_table()
        op.create_index(INDEX_ISSUES_ORGANISATION_ID, 'issues', ['organisation_id'])
        op.create_index(INDEX_ISSUES_AGENCE_STATUT, 'issues', ['agence_id', 'statut'])
        _create_actions_correctives_table()
        op.create_index(INDEX_ACTIONS_ISSUE_ID, 'actions_correctives', ['issue_id'])
        _create_historique_issues_table()
        op.create_index(INDEX_HISTORIQUE_ISSUE_ID, 'historique_issues', ['issue_id'])
        op.add_column('feedbacks', sa.Column('issue_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('issues.id', ondelete='SET NULL'), nullable=True))
        op.create_index(INDEX_FEEDBACKS_ISSUE_ID, 'feedbacks', ['issue_id'])
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)

    if 'issues' not in insp.get_table_names():
        _create_issues_table()
        insp = sa.inspect(bind)
    idx = {i['name'] for i in insp.get_indexes('issues')}
    if INDEX_ISSUES_ORGANISATION_ID not in idx:
        op.create_index(INDEX_ISSUES_ORGANISATION_ID, 'issues', ['organisation_id'])
    if INDEX_ISSUES_AGENCE_STATUT not in idx:
        op.create_index(INDEX_ISSUES_AGENCE_STATUT, 'issues', ['agence_id', 'statut'])

    if 'actions_correctives' not in insp.get_table_names():
        _create_actions_correctives_table()
        insp = sa.inspect(bind)
    idx = {i['name'] for i in insp.get_indexes('actions_correctives')}
    if INDEX_ACTIONS_ISSUE_ID not in idx:
        op.create_index(INDEX_ACTIONS_ISSUE_ID, 'actions_correctives', ['issue_id'])

    if 'historique_issues' not in insp.get_table_names():
        _create_historique_issues_table()
        insp = sa.inspect(bind)
    idx = {i['name'] for i in insp.get_indexes('historique_issues')}
    if INDEX_HISTORIQUE_ISSUE_ID not in idx:
        op.create_index(INDEX_HISTORIQUE_ISSUE_ID, 'historique_issues', ['issue_id'])

    cols_feedbacks = {c['name'] for c in insp.get_columns('feedbacks')}
    if 'issue_id' not in cols_feedbacks:
        op.add_column('feedbacks', sa.Column('issue_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('issues.id', ondelete='SET NULL'), nullable=True))
        insp = sa.inspect(bind)
    idx = {i['name'] for i in insp.get_indexes('feedbacks')}
    if INDEX_FEEDBACKS_ISSUE_ID not in idx:
        op.create_index(INDEX_FEEDBACKS_ISSUE_ID, 'feedbacks', ['issue_id'])


def downgrade():
    if context.is_offline_mode():
        op.drop_index(INDEX_FEEDBACKS_ISSUE_ID, table_name='feedbacks')
        op.drop_column('feedbacks', 'issue_id')
        op.drop_index(INDEX_HISTORIQUE_ISSUE_ID, table_name='historique_issues')
        op.drop_table('historique_issues')
        op.drop_index(INDEX_ACTIONS_ISSUE_ID, table_name='actions_correctives')
        op.drop_table('actions_correctives')
        op.drop_index(INDEX_ISSUES_AGENCE_STATUT, table_name='issues')
        op.drop_index(INDEX_ISSUES_ORGANISATION_ID, table_name='issues')
        op.drop_table('issues')
        return

    bind = op.get_bind()
    insp = sa.inspect(bind)

    cols_feedbacks = {c['name'] for c in insp.get_columns('feedbacks')} if 'feedbacks' in insp.get_table_names() else set()
    if 'issue_id' in cols_feedbacks:
        idx = {i['name'] for i in insp.get_indexes('feedbacks')}
        if INDEX_FEEDBACKS_ISSUE_ID in idx:
            op.drop_index(INDEX_FEEDBACKS_ISSUE_ID, table_name='feedbacks')
        op.drop_column('feedbacks', 'issue_id')

    if 'historique_issues' in insp.get_table_names():
        idx = {i['name'] for i in insp.get_indexes('historique_issues')}
        if INDEX_HISTORIQUE_ISSUE_ID in idx:
            op.drop_index(INDEX_HISTORIQUE_ISSUE_ID, table_name='historique_issues')
        op.drop_table('historique_issues')

    if 'actions_correctives' in insp.get_table_names():
        idx = {i['name'] for i in insp.get_indexes('actions_correctives')}
        if INDEX_ACTIONS_ISSUE_ID in idx:
            op.drop_index(INDEX_ACTIONS_ISSUE_ID, table_name='actions_correctives')
        op.drop_table('actions_correctives')

    if 'issues' in insp.get_table_names():
        idx = {i['name'] for i in insp.get_indexes('issues')}
        if INDEX_ISSUES_AGENCE_STATUT in idx:
            op.drop_index(INDEX_ISSUES_AGENCE_STATUT, table_name='issues')
        if INDEX_ISSUES_ORGANISATION_ID in idx:
            op.drop_index(INDEX_ISSUES_ORGANISATION_ID, table_name='issues')
        op.drop_table('issues')
