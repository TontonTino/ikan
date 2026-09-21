"""
Schémas Pydantic pour la supervision Admin de la facturation (Phase 4).
"""
import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class RepartitionForfait(BaseModel):
    id: uuid.UUID  # nécessaire côté dashboard pour le payload du PATCH /organisations/{id}/plan
    code: str
    nom: str
    nombre: int


class VueEnsembleFacturation(BaseModel):
    """Répartition des organisations par forfait + taux de conversion Gratuit->payant sur 30 jours.
    Formule exacte du taux (voir admin_facturation.py) : nombre d'organisations passées de Gratuit
    vers un forfait payant durant la fenêtre, divisé par l'ensemble des organisations qui étaient
    (ou sont toujours) Gratuit à un moment de la fenêtre — union de "actuellement Gratuit" et
    "converties durant la fenêtre", jamais une simple addition (pour ne pas compter deux fois une
    organisation qui aurait basculé puis été rétrogradée dans la même fenêtre)."""
    repartition: List[RepartitionForfait]
    nb_conversions_30j: int
    nb_base_calcul_30j: int
    taux_conversion_30j: Optional[float] = None  # None si nb_base_calcul_30j == 0 (rien à mesurer)


class OrganisationPaiementEchoue(BaseModel):
    organisation_id: uuid.UUID
    organisation_nom: str
    plan_code: str
    plan_nom: str
    payment_failed_at: datetime
    jours_restants_avant_degradation: int  # peut être négatif si le job de dégradation n'est pas encore passé


class ChangementPlanHistoriqueItem(BaseModel):
    id: uuid.UUID
    ancien_plan_code: Optional[str] = None
    ancien_plan_nom: Optional[str] = None
    nouveau_plan_code: str
    nouveau_plan_nom: str
    raison: Optional[str] = None
    source: str
    modifie_par_nom: Optional[str] = None
    created_at: datetime
