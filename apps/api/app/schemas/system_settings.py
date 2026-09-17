"""
Schémas Pydantic pour la configuration système.
"""
from uuid import UUID
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class SystemSettingsBase(BaseModel):
    nom_application: str = "IKAN AI — Plateforme Feedback Client"
    seuil_alerte_defaut: float = 80.0
    retention_mois: int = 24
    mode_ia: str = "deterministique"
    notifications_email_actives: bool = True


class SystemSettingsUpdate(BaseModel):
    nom_application: Optional[str] = None
    seuil_alerte_defaut: Optional[float] = None
    retention_mois: Optional[int] = None
    mode_ia: Optional[str] = None
    notifications_email_actives: Optional[bool] = None


class SystemSettingsResponse(SystemSettingsBase):
    id: UUID
    date_modification: datetime

    class Config:
        from_attributes = True
