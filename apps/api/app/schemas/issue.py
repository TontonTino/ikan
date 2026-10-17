"""
Schémas Pydantic pour les Issues et leurs actions correctives (V1 manuelle).
"""
from __future__ import annotations
import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, List

from app.models.enums import CriticiteType, IssueEscalationReason, UserRole
from app.schemas.feedback import FeedbackResponse


class IssueCreate(BaseModel):
    titre: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    agence_id: uuid.UUID
    categorie_id: Optional[uuid.UUID] = None
    severite: CriticiteType = CriticiteType.FAIBLE
    date_limite_sla: Optional[datetime] = None
    issue_origine_id: Optional[uuid.UUID] = None
    # Rattachement initial optionnel, en plus de PATCH /issues/{id}/rattacher-feedback/{feedback_id}.
    feedback_ids: List[uuid.UUID] = []


class IssueResponse(BaseModel):
    id: uuid.UUID
    organisation_id: uuid.UUID
    agence_id: uuid.UUID
    agence_nom: Optional[str] = None
    titre: str
    description: Optional[str] = None
    statut: str
    severite: CriticiteType
    categorie_id: Optional[uuid.UUID] = None
    categorie_nom: Optional[str] = None
    theme_principal: Optional[str] = None
    necessite_action: bool
    premiere_detection: datetime
    derniere_detection: Optional[datetime] = None
    date_resolution: Optional[datetime] = None
    date_limite_sla: Optional[datetime] = None
    issue_origine_id: Optional[uuid.UUID] = None
    date_verification: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActionCorrectiveCreate(BaseModel):
    titre: str = Field(..., min_length=3, max_length=200)
    description: Optional[str] = None
    responsable_id: Optional[uuid.UUID] = None
    echeance: Optional[datetime] = None


class ActionCorrectiveResponse(BaseModel):
    id: uuid.UUID
    issue_id: uuid.UUID
    titre: str
    description: Optional[str] = None
    statut: str
    responsable_id: Optional[uuid.UUID] = None
    echeance: Optional[datetime] = None
    date_completion: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IssueDetailResponse(IssueResponse):
    feedbacks: List[FeedbackResponse] = []
    actions: List[ActionCorrectiveResponse] = []


class IssueEscalationCreate(BaseModel):
    motif: IssueEscalationReason


class IssueEscalationResponse(BaseModel):
    id: uuid.UUID
    issue_id: uuid.UUID
    date_evenement: datetime
    motif: IssueEscalationReason
    declenchee_par_id: uuid.UUID
    declenchee_par_nom: str
    declenchee_par_role: UserRole
    created_at: datetime

    model_config = {"from_attributes": True}
