"""
Jeu de catégories de départ par secteur — app/services/categorie_templates.py.

SECTEUR_CATEGORIES_DEPART associe un secteur_code (app/services/secteurs.py) à la liste
des catégories à créer automatiquement pour toute NOUVELLE agence de ce secteur, chacune
avec sa clé stable (app/models/categorie.py::Categorie.cle) et son état actif par défaut.

Rempli pour telecom (pack v1) et restauration (pack restauration v1) ; vide pour tous les
autres secteurs : creer_categories_depart() ne fait rien pour un secteur sans
entrée, et le comportement actuel (catégorie "Général" créée à la volée par
app.services.categorie_service.get_or_create_categories_actives) reste intact.
"""
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.organisation import Organisation


@dataclass(frozen=True)
class CategorieDepart:
    cle: str
    libelle: str
    active: bool = True


# secteur_code -> liste des catégories de départ (ordre = ordre d'affichage souhaité).
SECTEUR_CATEGORIES_DEPART: dict[str, list[CategorieDepart]] = {
    "telecom": [
        CategorieDepart("accueil", "Accueil"),
        CategorieDepart("service_client", "Service Client"),
        CategorieDepart("carte_sim_numero", "Carte SIM & Numéro"),
        CategorieDepart("forfaits_recharge", "Forfaits & Recharge"),
        CategorieDepart("internet_reseau_mobile", "Internet & Réseau Mobile"),
        CategorieDepart("facturation_paiement", "Facturation & Paiement"),
        CategorieDepart("equipements_boutique", "Équipements & Boutique"),
        CategorieDepart("mobile_money", "Mobile Money", active=False),
    ],
    "restauration": [
        CategorieDepart("accueil_service_salle", "Accueil & service en salle"),
        CategorieDepart("qualite_plats", "Qualité des plats"),
        CategorieDepart("rapidite_attente", "Rapidité / Attente"),
        CategorieDepart("proprete_cadre", "Propreté & cadre"),
        CategorieDepart("addition_paiement", "Addition & paiement"),
        CategorieDepart("livraison_emporter", "Livraison / À emporter"),
        CategorieDepart("suggestion_compliment", "Suggestion / Compliment"),
    ],
}


def creer_categories_depart(db: Session, agence: Agence) -> list[Categorie]:
    """Crée les catégories de départ du secteur de l'organisation de `agence`, si ce
    secteur en a un (SECTEUR_CATEGORIES_DEPART) — idempotente : ne recrée jamais une clé
    déjà présente sur cette agence. Appelée à la création d'une agence
    (app/api/v1/endpoints/agences.py::create_agence) ; sans effet si le registre est vide
    pour ce secteur (comportement actuel de get_or_create_categories_actives inchangé).

    Ne modifie jamais une catégorie existante (nom, état actif) : se contente d'ajouter
    celles qui manquent encore, par clé.
    """
    organisation = db.query(Organisation).filter(Organisation.id == agence.organisation_id).first()
    secteur_code = organisation.secteur_code if organisation else None
    gabarits = SECTEUR_CATEGORIES_DEPART.get(secteur_code, [])
    if not gabarits:
        return []

    cles_existantes = {
        c.cle for c in db.query(Categorie).filter(Categorie.agence_id == agence.id, Categorie.cle.isnot(None)).all()
    }

    creees = []
    for gabarit in gabarits:
        if gabarit.cle in cles_existantes:
            continue
        categorie = Categorie(
            id=uuid.uuid4(), agence_id=agence.id, nom=gabarit.libelle,
            active=gabarit.active, cle=gabarit.cle,
        )
        db.add(categorie)
        creees.append(categorie)
    if creees:
        db.flush()
    return creees


# ── Rattrapage des clés sur des catégories EXISTANTES (migration 026, secteur telecom) ──
# Fonctions pures (aucun accès base, aucun import de migration) : la migration fait l'I/O
# brut (lecture/écriture SQL via sa.table, jamais les modèles ORM — voir sa docstring) et
# appelle ces fonctions pour la décision elle-même, qui est un choix produit (quel nom
# correspond à quelle clé, qui gagne un conflit) et mérite d'être testée indépendamment
# d'une base de données.

def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def normaliser_nom_categorie(nom: str) -> str:
    """Minuscules, sans accents, "&" retiré, espaces compactés — utilisé pour faire
    correspondre un nom de catégorie EXISTANT à un gabarit de SECTEUR_CATEGORIES_DEPART."""
    sans_accents = _sans_accents(nom.strip().lower()).replace("&", " ")
    return " ".join(sans_accents.split())


def cles_attendues_par_nom_normalise(secteur_code: str) -> dict[str, str]:
    """nom normalisé -> cle, dérivé des libellés de SECTEUR_CATEGORIES_DEPART pour ce
    secteur — une seule source de vérité pour "quel nom correspond à quelle clé" (le
    rattrapage ne doit jamais avoir sa propre liste parallèle, qui dériverait du jeu de
    départ). Un gabarit dont le libellé ne correspondrait jamais à une catégorie déjà
    existante (ex. "Mobile Money", créée nulle part avant ce pack) n'est simplement jamais
    trouvé par le rattrapage : rien à exclure explicitement ici."""
    return {
        normaliser_nom_categorie(gabarit.libelle): gabarit.cle
        for gabarit in SECTEUR_CATEGORIES_DEPART.get(secteur_code, [])
    }


# Sécurité explicite demandée (rapport ÉTAPE 0) : jamais ces noms, même si une évolution
# future de normaliser_nom_categorie changeait de comportement — aujourd'hui aucun ne
# correspond de toute façon à une clé de cles_attendues_par_nom_normalise.
JAMAIS_AFFECTER_NOMS_NORMALISES = frozenset({"nnv", "general", "formation", "proprete"})


class CandidatRattrapage(Protocol):
    """Forme minimale attendue d'une catégorie candidate à un rattrapage — un Protocol
    plutôt qu'un import du modèle ORM Categorie, pour rester testable avec de simples
    objets (voir tests/test_categorie_templates.py)."""
    id: object
    nom: str
    active: bool
    created_at: datetime


def resoudre_conflit_rattrapage(candidats: list[CandidatRattrapage]) -> tuple[CandidatRattrapage, list[CandidatRattrapage]]:
    """Parmi des catégories candidates à la MÊME clé dans la MÊME agence (nom normalisé
    identique) : une seule catégorie active -> elle gagne ; sinon la plus ancienne
    (created_at) gagne. Renvoie (gagnante, perdantes) — les perdantes ne sont JAMAIS
    modifiées par l'appelant, seulement listées dans le rapport de migration."""
    if len(candidats) == 1:
        return candidats[0], []
    actifs = [c for c in candidats if c.active]
    gagnant = actifs[0] if len(actifs) == 1 else min(candidats, key=lambda c: c.created_at)
    perdants = [c for c in candidats if c is not gagnant]
    return gagnant, perdants


def appliquer_rattrapage_cles(bind, secteur_code: str) -> list[str]:
    """Orchestration DB du rattrapage pour un secteur donné — I/O brut (sa.table, jamais
    les modèles ORM, voir la docstring de la migration 026) ; la décision elle-même reste
    dans les fonctions pures ci-dessus. Réutilisée par toute migration de rattrapage
    (026 pour le pack telecom v1, toute migration future pour un autre secteur) : factoriser
    ici évite exactement le genre de code dupliqué que l'audit KPI avait signalé comme
    fragile. Idempotente : ne retouche jamais une catégorie qui a déjà une clé.
    """
    import sqlalchemy as sa

    organisations = sa.table("organisations", sa.column("id"), sa.column("secteur_code"))
    agences = sa.table("agences", sa.column("id"), sa.column("organisation_id"))
    categories = sa.table(
        "categories_agence",
        sa.column("id"), sa.column("agence_id"), sa.column("nom"),
        sa.column("active"), sa.column("cle"), sa.column("created_at"),
    )

    cles_par_nom = cles_attendues_par_nom_normalise(secteur_code)
    rapport: list[str] = []
    if not cles_par_nom:
        return rapport

    org_ids = [
        row.id for row in bind.execute(
            sa.select(organisations.c.id).where(organisations.c.secteur_code == secteur_code)
        ).fetchall()
    ]
    if not org_ids:
        return rapport

    agence_ids = [
        row.id for row in bind.execute(
            sa.select(agences.c.id).where(agences.c.organisation_id.in_(org_ids))
        ).fetchall()
    ]
    if not agence_ids:
        return rapport

    for agence_id in agence_ids:
        # Toutes les catégories (pas seulement cle IS NULL) : il faut voir, pour un groupe
        # de noms déjà résolu lors d'un run précédent, qu'une d'elles porte déjà la clé —
        # sinon une catégorie perdante (jamais affectée, donc toujours cle IS NULL) redevient
        # candidate à chaque réexécution et finit par violer l'unicité une fois seule restante.
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
