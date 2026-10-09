"""
Registre des packs de KPI par secteur.

COMMUN_PRIORITAIRE et COMMUN_OPERATIONNEL sont dérivés de `KPIDefinition.famille`
(app/services/kpi/definitions.py) — une seule source de vérité, pas de liste de codes
dupliquée ici. Toute organisation, quel que soit son secteur, voit COMMUNS : le socle
CX Core, soit les 8 KPI universels (COMMUN_OPERATIONNEL est vide aujourd'hui, conservé
pour compatibilité).

PACKS ajoute, par secteur_code (app/services/secteurs.py), les KPI d'extension de ce
secteur — décision produit, jamais déduite du seul fait qu'un calcul est réutilisable :
- "banque" : extension Banking, les 7 KPI bancaires (NPS, backlog et son âge, actions,
  SLA, récurrence, escalades), déclarés avec secteur_code="banque" dans definitions.py.
- "telecom" : pack telecom (3 KPI TEL_* basés sur les Issues, 3 KPI TEL_RECLAMATIONS_*
  basés sur les feedbacks — voir app/services/kpi/packs_telecom.py pour les groupes et
  les clés de catégories) + NPS, ouvert explicitement au telecom. Les 6 autres KPI
  bancaires n'y sont volontairement pas : leurs règles (délais, SLA, récurrence,
  escalades) ne sont pas transposées automatiquement à un autre secteur.
Tous les autres secteurs restent vides (CX Core seulement). Un KPI peut figurer dans
plusieurs packs ; GET /kpis/ (app/api/v1/endpoints/kpis.py) n'a besoin d'aucun changement.

pack_sectoriel_accessible(plan_code) : un seul endroit à modifier quand l'équipe aura
décidé si le pack sectoriel est inclus dans tous les forfaits ou réservé à certains.
Renvoie True pour tous aujourd'hui.
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

# secteur_code -> codes KPI du pack de ce secteur. Une valeur ici doit être une liste de
# codes présents dans KPI_DEFINITIONS avec famille=FAMILLE_SECTORIEL. Tous les secteurs
# restent vides sauf banque et telecom.
PACKS: dict[str, tuple[str, ...]] = {code: () for code in SECTEUR_CODES}
PACKS["banque"] = (
    "NPS",
    "ISSUE_BACKLOG",
    "BACKLOG_AGE",
    "ACTION_COMPLETION_RATE",
    "SLA_COMPLIANCE_RATE",
    "ISSUE_RECURRENCE_RATE",
    "ESCALATION_RATE",
)
PACKS["telecom"] = (
    "TEL_PART_HORS_PERIMETRE",
    "TEL_RECURRENCE_AGENCE",
    "TEL_RECURRENCE_HORS_PERIMETRE",
    "NPS",
    "TEL_RECLAMATIONS_RESEAU",
    "TEL_RECLAMATIONS_RECHARGE_FORFAIT",
    "TEL_RECLAMATIONS_FACTURATION",
)


def pack_sectoriel_accessible(plan_code: str | None) -> bool:
    """True si le pack sectoriel est inclus pour ce forfait. Décision
    produit pas encore prise (voir le rapport d'audit KPI, section Accès par forfait) :
    True pour tous, pour l'instant — modifiable en un seul endroit."""
    return True


def kpis_visibles(secteur_code: str | None, plan_code: str | None = None) -> tuple[str, ...]:
    """Codes KPI visibles pour une organisation : les communs CX Core (toujours, aucune
    restriction de forfait), puis le pack de son secteur s'il en a un ET si ce forfait y
    donne accès. Un secteur_code inconnu du registre (ne devrait pas arriver grâce à la
    contrainte CHECK en base) ou un pack vide ne changent rien : les communs seulement,
    jamais une exception.
    """
    pack = PACKS.get(secteur_code, ()) if pack_sectoriel_accessible(plan_code) else ()
    return COMMUNS + pack
