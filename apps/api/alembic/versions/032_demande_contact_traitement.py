"""Traitement d'une demande de rappel : date et auteur (AM-07, « Marquer comme recontacté »).

Deux colonnes NULLABLES sur demandes_contact, sans valeur par défaut et SANS remplissage des lignes existantes :
- date_traitement : date du premier traitement ;
- traitee_par_id  : auteur du traitement, clé étrangère vers utilisateurs (ON DELETE SET NULL : supprimer un compte ne
  supprime ni ne bloque jamais une demande).
Les demandes déjà traitées avant cette migration gardent traitee = true avec une date et un auteur NULL
(« traitée avant la mise à jour de la traçabilité »).

Verrous : ajouter une colonne nullable sans défaut ne réécrit pas la table (PostgreSQL 11 et plus). L'ajout de la clé
étrangère prend brièvement un verrou sur demandes_contact et utilisateurs ; les colonnes étant vides et la table petite, la
durée est négligeable. `SET LOCAL lock_timeout` : si le verrou n'est pas obtenu en 5 s la migration ÉCHOUE (et le déploiement
avec elle, l'ancienne version reste en ligne) au lieu de mettre le trafic en file d'attente derrière elle. SET LOCAL ne vaut que
pour la transaction de la migration (alembic/env.py exécute tout dans une transaction).

Idempotente (IF NOT EXISTS / garde pg_constraint) : peut s'exécuter deux fois sans erreur. Additive : le code antérieur
continue de fonctionner (il ignore ces colonnes).

DOWNGRADE : supprime les deux colonnes (date et auteur du traitement perdus ; l'événement « demande_recontactee » de
l'historique des avis les conserve). Aucun refus.

Revision ID: 032_demande_contact_traitement
Revises: 031_suggestion_sans_feedback
"""
from alembic import op

revision = "032_demande_contact_traitement"
down_revision = "031_suggestion_sans_feedback"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE demandes_contact ADD COLUMN IF NOT EXISTS date_traitement TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE demandes_contact ADD COLUMN IF NOT EXISTS traitee_par_id UUID")
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_demandes_contact_traitee_par_id') THEN
                ALTER TABLE demandes_contact
                    ADD CONSTRAINT fk_demandes_contact_traitee_par_id
                    FOREIGN KEY (traitee_par_id) REFERENCES utilisateurs (id) ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )


def downgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("ALTER TABLE demandes_contact DROP CONSTRAINT IF EXISTS fk_demandes_contact_traitee_par_id")
    op.execute("ALTER TABLE demandes_contact DROP COLUMN IF EXISTS traitee_par_id")
    op.execute("ALTER TABLE demandes_contact DROP COLUMN IF EXISTS date_traitement")
