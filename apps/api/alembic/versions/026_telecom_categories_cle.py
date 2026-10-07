"""Backfill categories_agence.cle for existing telecom-sector organisations (rattrapage).

Revision ID: 026_telecom_categories_cle
Revises: 025_categorie_cle
Create Date: 2026-10-07 12:45:00

Scope : UNIQUEMENT les organisations avec secteur_code = 'telecom' (posé par la migration
024_organisation_secteur_code, qui précède forcément celle-ci). Pour chaque agence de ces
organisations, associe à une catégorie EXISTANTE la clé stable correspondante quand son
nom, normalisé (minuscules, sans accents, trim, "&" ignoré), correspond à l'un des
libellés de SECTEUR_CATEGORIES_DEPART["telecom"]
(app/services/categorie_templates.py — une seule source de vérité pour "quel nom
correspond à quelle clé" : cette migration importe cette décision plutôt que de la
dupliquer, voir la docstring de ce module applicatif pour pourquoi c'est le bon compromis
ici, contrairement à l'import de modèles ORM qu'on évite par ailleurs dans les migrations).

Conflit (deux catégories de la même agence normalisent vers le même nom) : n'affecte que
l'une d'entre elles — resoudre_conflit_rattrapage() (catégorie active si une seule l'est,
sinon la plus ancienne) — et JAMAIS les autres. Les conflits rencontrés sont listés par ce
script (stdout) et doivent être recopiés dans la description de la PR, pas re-décidés
silencieusement à chaque nouveau déploiement : une fois une clé posée, cette migration ne
la retouche plus jamais (elle ne traite que les catégories encore sans clé).

Ne modifie JAMAIS `nom` ni `active`. N'affecte jamais une catégorie dont le nom normalisé
ne correspond à aucune clé attendue ; JAMAIS_AFFECTER_NOMS_NORMALISES ajoute une sécurité
explicite pour "nnv", "général"/"general", "formation", "propreté"/"proprete" en plus de
la non-correspondance naturelle.

Additive et idempotente : AUCUNE colonne ni table supprimée, aucune catégorie supprimée ou
renommée. Ne fait rien pour une organisation sans secteur telecom, ou pour une catégorie
déjà pourvue d'une clé (rejouable sans effet une fois les clés posées).
"""
from alembic import context, op
import sqlalchemy as sa

from app.services.categorie_templates import (
    JAMAIS_AFFECTER_NOMS_NORMALISES,
    cles_attendues_par_nom_normalise,
    normaliser_nom_categorie,
    resoudre_conflit_rattrapage,
)

revision = "026_telecom_categories_cle"
down_revision = "025_categorie_cle"
branch_labels = None
depends_on = None


def _rattraper(bind) -> list[str]:
    organisations = sa.table("organisations", sa.column("id"), sa.column("secteur_code"))
    agences = sa.table("agences", sa.column("id"), sa.column("organisation_id"))
    categories = sa.table(
        "categories_agence",
        sa.column("id"), sa.column("agence_id"), sa.column("nom"),
        sa.column("active"), sa.column("cle"), sa.column("created_at"),
    )

    cles_par_nom = cles_attendues_par_nom_normalise("telecom")
    rapport: list[str] = []

    telecom_org_ids = [
        row.id for row in bind.execute(
            sa.select(organisations.c.id).where(organisations.c.secteur_code == "telecom")
        ).fetchall()
    ]
    if not telecom_org_ids:
        return rapport

    agence_ids = [
        row.id for row in bind.execute(
            sa.select(agences.c.id).where(agences.c.organisation_id.in_(telecom_org_ids))
        ).fetchall()
    ]
    if not agence_ids:
        return rapport

    for agence_id in agence_ids:
        # Toutes les catégories (pas seulement cle IS NULL) : il faut voir, pour un groupe
        # de noms déjà résolu lors d'un run précédent, que l'une d'elles porte déjà la clé —
        # sinon une catégorie perdante (jamais affectée, donc toujours cle IS NULL) redevient
        # candidate à chaque réexécution et finit par violer l'unicité (agence_id, cle) une
        # fois seule restante. Idempotence vérifiée par un test de migration dédié.
        cat_rows = bind.execute(
            sa.select(categories.c.id, categories.c.nom, categories.c.active,
                      categories.c.cle, categories.c.created_at)
            .where(categories.c.agence_id == agence_id)
        ).fetchall()

        par_normalise: dict[str, list] = {}
        for row in cat_rows:
            normalise = normaliser_nom_categorie(row.nom)
            if normalise in JAMAIS_AFFECTER_NOMS_NORMALISES or normalise not in cles_par_nom:
                continue
            par_normalise.setdefault(normalise, []).append(row)

        for normalise, candidats in par_normalise.items():
            if any(c.cle is not None for c in candidats):
                continue  # déjà résolu lors d'un run précédent : ne jamais retoucher

            cle = cles_par_nom[normalise]
            gagnant, perdants = resoudre_conflit_rattrapage(candidats)
            if perdants:
                rapport.append(
                    f"conflit agence={agence_id} nom_normalise='{normalise}' cle='{cle}' "
                    f"gagnant={gagnant.id} (active={gagnant.active}) "
                    f"perdants={[(str(c.id), c.nom, c.active) for c in perdants]}"
                )
            bind.execute(categories.update().where(categories.c.id == gagnant.id).values(cle=cle))
            rapport.append(f"agence={agence_id} '{gagnant.nom}' -> cle='{cle}'")

    return rapport


def upgrade():
    if context.is_offline_mode():
        return  # Migration de données uniquement : rien à produire en mode offline (--sql).

    bind = op.get_bind()
    rapport = _rattraper(bind)
    if rapport:
        print("[026_telecom_categories_cle] " + " | ".join(rapport))


def downgrade():
    # Rattrapage volontairement non réversible via downgrade spécifique : la migration 025
    # (downgrade) retire déjà la colonne cle dans son ensemble si on redescend plus bas.
    # Redescendre uniquement cette révision ne doit rien défaire de spécifique à elle.
    pass
