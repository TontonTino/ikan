"""Retry 026_telecom_categories_cle: production found 0 matches on first run.

Revision ID: 027_telecom_cles_retry
Revises: 026_telecom_categories_cle
Create Date: 2026-10-08 09:00:00

Constat (lecture seule sur la base de démo partagée, avant d'écrire cette migration) :
`alembic_version` est bien à `026_telecom_categories_cle` (la migration s'est terminée sans
erreur) et `organisations.secteur_code = 'telecom'` est correctement posé pour Orange
Burkina Faso — mais les 73 catégories actives de cette organisation ont toutes `cle IS
NULL` : le rattrapage n'a affecté aucune ligne lors de son unique exécution. Cause précise
non confirmée (candidat le plus probable : séquencement entre le backfill de
secteur_code par 024 et la lecture de cette même colonne par 026 au sein du même
déploiement) — non reproduite localement, où la même logique, rejouée contre un clone des
données réelles, trouve correctement les 71 correspondances attendues (0 conflit).

Cette migration RÉAPPLIQUE exactement la même opération, désormais via
app.services.categorie_templates.appliquer_rattrapage_cles (factorisée depuis le corps de
026, pour que toute migration de rattrapage future — un autre secteur, un autre retry — la
réutilise au lieu de la dupliquer). Idempotente par construction (ne retouche jamais une
catégorie qui a déjà une clé) : si 026 avait finalement eu de l'effet par un autre canal
d'ici l'exécution de celle-ci, cette migration ne fait rien.

Additive : aucune colonne ni table ajoutée ou supprimée, aucune catégorie supprimée ou
renommée, aucun nom ni état actif modifié — seule la colonne `cle`, déjà ajoutée par 025,
est éventuellement renseignée.
"""
from alembic import context, op

from app.services.categorie_templates import appliquer_rattrapage_cles

revision = "027_telecom_cles_retry"
down_revision = "026_telecom_categories_cle"
branch_labels = None
depends_on = None


def upgrade():
    if context.is_offline_mode():
        return  # Migration de données uniquement : rien à produire en mode offline (--sql).

    bind = op.get_bind()
    rapport = appliquer_rattrapage_cles(bind, "telecom")
    if rapport:
        print("[027_telecom_cles_retry] " + " | ".join(rapport))
    else:
        print("[027_telecom_cles_retry] aucune catégorie à rattraper (déjà fait, ou secteur telecom vide).")


def downgrade():
    # Rien de spécifique à défaire : voir 026_telecom_categories_cle.downgrade (la colonne
    # cle dans son ensemble n'est retirée que par 025, pas par ce niveau de révision).
    pass
