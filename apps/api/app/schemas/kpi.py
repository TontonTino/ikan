"""
Schéma de résultat standardisé du KPI Engine (app/services/kpi/). Une seule forme de
résultat pour les 8 KPI P0, quelle que soit leur nature (taux, volume, durée).
"""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class KPIResult(BaseModel):
    code: str
    label: str
    unit: str  # "percent" | "count" | "hours"
    # "ok" : value/numerator/denominator significatifs. "no_data" : dénominateur nul ou
    # aucune donnée exploitable — value reste alors None, jamais artificiellement 0.
    status: str = "ok"
    value: Optional[float] = None
    numerator: Optional[float] = None
    denominator: Optional[float] = None
    # Métadonnées additionnelles, utilisées seulement par LOOP_CLOSURE_RATE pour l'instant.
    verified_count: Optional[int] = None
    requiring_action_count: Optional[int] = None
