"""Épisodes d'alerte de seuil : table `alerte_episodes` (une ligne = un dépassement du seuil d'une agence, du début à la fin).

PR 2/5 du cycle de vie des alertes. ADDITIVE : une seule table NOUVELLE, créée vide, et ses index. Aucune table existante n'est modifiée,
aucune donnée n'est touchée, aucune ligne n'est insérée (pas de passé fabriqué : les épisodes naissent à la première lecture de GET /alertes/).
Le code antérieur ignore cette table.

- colonnes : identifiant, organisation et agence (clés étrangères, suppression en cascade avec elles), type (aujourd'hui seulement
  « seuil_satisfaction »), statut (« detectee », « prise_en_charge », « terminee »), début de la condition RECONSTITUÉ d'après les avis
  (`debut_condition`, toujours approximatif : le seuil actuel est appliqué au passé ; `debut_remontee_limitee` si la reconstitution a
  atteint sa limite) distinct de la date de première détection (`detecte_le`), contexte figé à l'ouverture et à la fin, prise en charge
  (écrite par une PR ultérieure ; colonnes prévues ici pour ne pas multiplier les migrations), cause de fin ;
- UN SEUL épisode non terminé par agence et par type : index unique PARTIEL `uq_alerte_episode_ouvert (agence_id, type) WHERE statut <> 'terminee'` ;
- contraintes CHECK : valeurs de statut, de type et de cause de fin ; cohérence entre statut et dates (un épisode terminé a une fin, une cause et une
  date de fin, un épisode non terminé n'en a aucune ; une prise en charge a une date ; une fin n'est jamais avant le début) ;
- toutes les dates en `timestamptz` (UTC).

Verrous : `SET LOCAL lock_timeout = '5s'` (la migration ÉCHOUE, et le déploiement avec elle, plutôt que de faire attendre le trafic). Les verrous ne
portent que sur des tables créées dans cette même transaction (hormis la lecture des clés étrangères vers `agences`, `organisations`, `utilisateurs`).
Idempotente : IF NOT EXISTS — peut s'exécuter deux fois sans erreur.

DOWNGRADE : supprime la table (les épisodes sont PERDUS ; ils se reconstituent à la lecture suivante, sans leur historique). Aucune autre table touchée.

Revision ID: 034_alerte_episodes
Revises: 033_journal_audit
"""
from alembic import op

revision = "034_alerte_episodes"
down_revision = "033_journal_audit"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS alerte_episodes (
            id UUID PRIMARY KEY,
            organisation_id UUID NOT NULL REFERENCES organisations (id) ON DELETE CASCADE,
            agence_id UUID NOT NULL REFERENCES agences (id) ON DELETE CASCADE,
            type VARCHAR(40) NOT NULL DEFAULT 'seuil_satisfaction',
            statut VARCHAR(20) NOT NULL DEFAULT 'detectee',
            debut_condition TIMESTAMP WITH TIME ZONE NOT NULL,
            debut_approximatif BOOLEAN NOT NULL DEFAULT TRUE,
            debut_remontee_limitee BOOLEAN NOT NULL DEFAULT FALSE,
            detecte_le TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            taux_ouverture DOUBLE PRECISION NOT NULL,
            seuil_ouverture DOUBLE PRECISION NOT NULL,
            gravite_ouverture VARCHAR(20),
            pris_en_charge_le TIMESTAMP WITH TIME ZONE,
            pris_en_charge_par_id UUID REFERENCES utilisateurs (id) ON DELETE SET NULL,
            pris_en_charge_par_nom VARCHAR(200),
            commentaire_prise_en_charge VARCHAR(500),
            fin_condition TIMESTAMP WITH TIME ZONE,
            terminee_le TIMESTAMP WITH TIME ZONE,
            fin_cause VARCHAR(30),
            taux_fermeture DOUBLE PRECISION,
            seuil_fermeture DOUBLE PRECISION,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_alerte_episodes_type CHECK (type IN ('seuil_satisfaction')),
            CONSTRAINT ck_alerte_episodes_statut CHECK (statut IN ('detectee', 'prise_en_charge', 'terminee')),
            CONSTRAINT ck_alerte_episodes_fin_cause CHECK (
                fin_cause IS NULL OR fin_cause IN ('retablie', 'donnees_insuffisantes', 'seuil_modifie', 'agence_desactivee')
            ),
            CONSTRAINT ck_alerte_episodes_terminee CHECK (
                (statut = 'terminee' AND terminee_le IS NOT NULL AND fin_cause IS NOT NULL AND fin_condition IS NOT NULL)
                OR (statut <> 'terminee' AND terminee_le IS NULL AND fin_cause IS NULL AND fin_condition IS NULL)
            ),
            CONSTRAINT ck_alerte_episodes_prise_en_charge CHECK (
                (statut <> 'detectee' OR pris_en_charge_le IS NULL)
                AND (statut <> 'prise_en_charge' OR pris_en_charge_le IS NOT NULL)
            ),
            CONSTRAINT ck_alerte_episodes_fin_apres_debut CHECK (fin_condition IS NULL OR fin_condition >= debut_condition)
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_alerte_episode_ouvert ON alerte_episodes (agence_id, type) WHERE statut <> 'terminee'"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_alerte_episodes_agence_debut ON alerte_episodes (agence_id, debut_condition DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_alerte_episodes_organisation_debut ON alerte_episodes (organisation_id, debut_condition DESC)")


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DROP TABLE IF EXISTS alerte_episodes")
