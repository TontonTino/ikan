"""
Registre des packs de KPI par secteur.

COMMUN_PRIORITAIRE et COMMUN_OPERATIONNEL sont dérivés de `KPIDefinition.famille`
(app/services/kpi/definitions.py) — une seule source de vérité, pas de liste de codes
dupliquée ici. Toute organisation, quel que soit son secteur, voit les deux : ce sont les
14 KPI déjà calculés par le moteur aujourd'hui (voir le rapport d'audit KPI).

PACKS ajoute, par secteur_code (app/services/secteurs.py), les KPI PROPRES à ce secteur —
vide pour tous les secteurs aujourd'hui. Aucun pack sectoriel n'est encore implémenté :
le "pack banque" annoncé avant l'audit n'existait pas dans le code. Remplir
PACKS["banque"] avec les codes du futur pack bancaire (eux-mêmes déclarés dans
definitions.py avec famille=FAMILLE_SECTORIEL et secteur_code="banque") sera tout ce qu'il
faudra faire ici ; GET /kpis/ (app/api/v1/endpoints/kpis.py) n'a besoin d'aucun changement.

pack_sectoriel_accessible(plan_code) : un seul endroit à modifier quand l'équipe aura
décidé si le pack sectoriel est inclus dans tous les forfaits ou réservé à certains.
Renvoie True pour tous aujourd'hui — sans effet visible tant que PACKS est vide.
"""
from app.services.kpi.definitions import (
    FAMILLE_COMMUN_OPERATIONNEL,
    FAMILLE_COMMUN_PRIORITAIRE,
    KPI_DEFINITIONS,
)
from app.services.secteurs import SECTEUR_CODES

COMMUN_PRIORITAIRE: tuple[str, ...] = tuple(
    code for code, d in KPI_DEFINITIONS.items() if d.famille == FAMILLE_COMMUN_PRIORITAIRE
)
COMMUN_OPERATIONNEL: tuple[str, ...] = tuple(
    code for code, d in KPI_DEFINITIONS.items() if d.famille == FAMILLE_COMMUN_OPERATIONNEL
)
COMMUNS: tuple[str, ...] = COMMUN_PRIORITAIRE + COMMUN_OPERATIONNEL

# secteur_code -> codes KPI du pack de ce secteur. Vide pour tous les secteurs aujourd'hui ;
# une valeur ici doit être une liste de codes présents dans KPI_DEFINITIONS avec
# famille=FAMILLE_SECTORIEL et secteur_code=<ce secteur>.
PACKS: dict[str, tuple[str, ...]] = {code: () for code in SECTEUR_CODES}


def pack_sectoriel_accessible(plan_code: str | None) -> bool:
    """True si le pack sectoriel (quand il existera) est inclus pour ce forfait. Décision
    produit pas encore prise (voir le rapport d'audit KPI, section Accès par forfait) :
    True pour tous, pour l'instant — modifiable en un seul endroit."""
    return True


def kpis_visibles(secteur_code: str | None, plan_code: str | None = None) -> tuple[str, ...]:
    """Codes KPI visibles pour une organisation : les communs (toujours, aucune
    restriction de forfait), puis le pack de son secteur s'il en a un ET si ce forfait y
    donne accès. Un secteur_code inconnu du registre (ne devrait pas arriver grâce à la
    contrainte CHECK en base) ou un pack vide ne changent rien : les communs seulement,
    jamais une exception.
    """
    pack = PACKS.get(secteur_code, ()) if pack_sectoriel_accessible(plan_code) else ()
    return COMMUNS + pack
