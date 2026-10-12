"""Suggestions sans feedback : feedback_id nullable + agence_id (CL-05, « Partager une idée »).

Une suggestion envoyée seule (sans note) ne doit créer AUCUN feedback (donc aucune note fictive dans le CSAT, le volume ou
le quota). Elle se rattache donc directement à l'agence :
- suggestions.feedback_id devient NULLABLE (les lignes existantes sont inchangées) ;
- suggestions.agence_id : nouvelle colonne, clé étrangère NULLABLE vers agences (ON DELETE CASCADE, comme la chaîne
  agence -> QR -> feedback -> suggestion actuelle), indexée. AUCUN remplissage des lignes existantes : leur agence reste
  déduite de leur feedback (COALESCE côté lecture, voir app/services/suggestions_scope.py) ;
- CHECK : une suggestion a un feedback OU une agence (les lignes existantes, qui ont toutes un feedback, le respectent).

Idempotente (IF NOT EXISTS / gardes pg_constraint) : peut s'exécuter deux fois sans erreur.
Additive : le code antérieur continue de fonctionner (il n'écrit que des suggestions avec feedback).

DOWNGRADE : REFUSÉ s'il existe des suggestions sans feedback (feedback_id NULL) : les supprimer ou les rattacher
silencieusement détruirait des données. Le message indique le nombre de lignes concernées.

Revision ID: 031_suggestion_sans_feedback
Revises: 030_demande_contact_consentement
"""
from alembic import op

revision = "031_suggestion_sans_feedback"
down_revision = "030_demande_contact_consentement"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE suggestions ALTER COLUMN feedback_id DROP NOT NULL")
    op.execute("ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS agence_id UUID")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_suggestions_agence_id') THEN
                ALTER TABLE suggestions
                    ADD CONSTRAINT fk_suggestions_agence_id
                    FOREIGN KEY (agence_id) REFERENCES agences (id) ON DELETE CASCADE;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_suggestions_feedback_ou_agence') THEN
                ALTER TABLE suggestions
                    ADD CONSTRAINT ck_suggestions_feedback_ou_agence
                    CHECK (feedback_id IS NOT NULL OR agence_id IS NOT NULL);
            END IF;
        END $$;
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_suggestions_agence_id ON suggestions (agence_id)")


def downgrade():
    connexion = op.get_bind()
    orphelines = connexion.exec_driver_sql("SELECT count(*) FROM suggestions WHERE feedback_id IS NULL").scalar()
    if orphelines:
        raise RuntimeError(
            f"Downgrade 031 refusé : {orphelines} suggestion(s) sans feedback (feedback_id NULL) existent. "
            "Les supprimer ou les rattacher à un feedback fictif détruirait ou falsifierait des données. "
            "Traitez-les d'abord (export, puis suppression volontaire), puis relancez le downgrade."
        )
    op.execute("ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS ck_suggestions_feedback_ou_agence")
    op.execute("DROP INDEX IF EXISTS ix_suggestions_agence_id")
    op.execute("ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS fk_suggestions_agence_id")
    op.execute("ALTER TABLE suggestions DROP COLUMN IF EXISTS agence_id")
    op.execute("ALTER TABLE suggestions ALTER COLUMN feedback_id SET NOT NULL")
