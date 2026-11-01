"""Journal d'audit des actions sensibles (AD-08, SD-13, AD-03) : table `journal_audit`, en AJOUT SEUL.

Une seule table NOUVELLE, aucune table existante modifiée, aucune donnée touchée (le code antérieur l'ignore) :
- colonnes : identifiant, date UTC, acteur (identifiant SANS clé étrangère, rôle, instantané de l'e-mail), code d'action stable,
  cible (type, identifiant, libellé instantané), organisation concernée (identifiant sans clé étrangère), résultat (succes/refus,
  contrainte CHECK), détails minimaux (JSONB), adresse IP tronquée (IPv4 en /24, IPv6 en /48) ;
- AUCUNE clé étrangère : le journal survit à la suppression d'un compte ou d'une organisation (ni cascade qui le supprimerait, ni
  SET NULL qui le modifierait) ; les instantanés le rendent lisible sans jointure ;
- 4 index : date décroissante, (acteur, date), (action, date), (organisation, date) ;
- append-only : déclencheur BEFORE UPDATE OR DELETE (par ligne) et BEFORE TRUNCATE (par instruction) qui lèvent une exception. Ils
  ne portent que sur CETTE table, créée vide par cette migration : aucun risque pour les tables existantes.

PURGE FUTURE (SD-06, NON construite ici) : la durée de conservation recommandée est de 12 mois minimum. Une purge ne contournera
jamais ce déclencheur en le supprimant : une migration dédiée remplacera la FONCTION `journal_audit_interdire_modification()`
(CREATE OR REPLACE) pour autoriser UNIQUEMENT le DELETE, et seulement quand la transaction a posé `SET LOCAL ikan.purge_journal = 'on'`,
depuis une procédure unique de purge (bornée par date, elle-même journalisée). UPDATE et TRUNCATE resteront toujours refusés.

Verrous : `SET LOCAL lock_timeout = '5s'` (la migration ÉCHOUE, et le déploiement avec elle, plutôt que de faire attendre le trafic).
Les verrous ne portent que sur la table créée dans cette même transaction.
Idempotente : IF NOT EXISTS, CREATE OR REPLACE, garde pg_trigger — peut s'exécuter deux fois sans erreur.
Compatible avec la base actuelle (version 032) : rien d'autre n'est requis.

DOWNGRADE : supprime la table (le journal est PERDU) et la fonction. Aucun refus : à n'utiliser que volontairement.

Revision ID: 033_journal_audit
Revises: 032_demande_contact_traitement
"""
from alembic import op

revision = "033_journal_audit"
down_revision = "032_demande_contact_traitement"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS journal_audit (
            id UUID PRIMARY KEY,
            date_action TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            acteur_id UUID,
            acteur_role VARCHAR(30) NOT NULL,
            acteur_email VARCHAR(255),
            action VARCHAR(60) NOT NULL,
            cible_type VARCHAR(40),
            cible_id VARCHAR(64),
            cible_libelle VARCHAR(200),
            organisation_id UUID,
            resultat VARCHAR(10) NOT NULL,
            details JSONB,
            adresse_ip VARCHAR(45),
            CONSTRAINT ck_journal_audit_resultat CHECK (resultat IN ('succes', 'refus'))
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_journal_audit_date_action ON journal_audit (date_action DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_journal_audit_acteur ON journal_audit (acteur_id, date_action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_journal_audit_action ON journal_audit (action, date_action)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_journal_audit_organisation ON journal_audit (organisation_id, date_action)")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION journal_audit_interdire_modification() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'journal_audit est en ajout seul : % refusé', TG_OP USING ERRCODE = '42501';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_journal_audit_append_only' AND NOT tgisinternal) THEN
                CREATE TRIGGER trg_journal_audit_append_only BEFORE UPDATE OR DELETE ON journal_audit
                    FOR EACH ROW EXECUTE FUNCTION journal_audit_interdire_modification();
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_journal_audit_no_truncate' AND NOT tgisinternal) THEN
                CREATE TRIGGER trg_journal_audit_no_truncate BEFORE TRUNCATE ON journal_audit
                    FOR EACH STATEMENT EXECUTE FUNCTION journal_audit_interdire_modification();
            END IF;
        END $$
        """
    )


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DROP TABLE IF EXISTS journal_audit")
    op.execute("DROP FUNCTION IF EXISTS journal_audit_interdire_modification()")
