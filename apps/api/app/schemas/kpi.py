"""
Schéma de résultat standardisé du KPI Engine (app/services/kpi/). Une seule forme de
résultat pour les 8 KPI P0, quelle que soit leur nature (taux, volume, durée).
"""
from __future__ import annotations
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel


class KPIResult(BaseModel):
    code: str
    label: str
    unit: str  # "percent" | "count" | "hours" | "points"
    # "ok" : value/numerator/denominator significatifs. "no_data" : dénominateur nul ou
    # aucune donnée exploitable — value reste alors None, jamais artificiellement 0.
    status: str = "ok"
    value: Optional[float] = None
    numerator: Optional[float] = None
    denominator: Optional[float] = None
    # Métadonnées additionnelles, utilisées seulement par LOOP_CLOSURE_RATE pour l'instant.
    verified_count: Optional[int] = None
    requiring_action_count: Optional[int] = None
    # Famille du KPI (commun_prioritaire | commun_operationnel | sectoriel), posée par
    # l'endpoint depuis KPI_DEFINITIONS — jamais calculée par le moteur lui-même. Additif :
    # None pour un appelant qui ne la demande pas explicitement n'est pas attendu, mais le
    # champ reste optionnel pour ne jamais faire échouer une validation existante.
    famille: Optional[str] = None


class KPICollectionResponse(BaseModel):
    """Enveloppe de GET /api/v1/kpis — organisation_id/agence_id reflètent le périmètre
    RÉELLEMENT appliqué (agence_id forcé pour un Agency Manager), pas les paramètres bruts."""
    organisation_id: UUID
    agence_id: Optional[UUID] = None
    jours: int
    kpis: List[KPIResult]
    # Secteur de l'organisation et disponibilité de son pack — évite au frontend un appel
    # séparé pour savoir s'il doit afficher la note "KPIs sectoriels bientôt disponibles".
    secteur_code: Optional[str] = None
    pack_disponible: bool = False
