"""
GET /secteurs — liste code/libellé des secteurs d'activité, source unique pour le select
du dashboard (AdminOrgsPage) et pour tout appelant qui a besoin des codes valides. Accessible
à tout utilisateur authentifié (pas de restriction de rôle : la liste n'expose aucune donnée
d'organisation).
"""
from typing import List

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.models.utilisateur import Utilisateur
from app.schemas.secteur import SecteurInfo
from app.services.secteurs import secteurs_disponibles

router = APIRouter()


@router.get("/", response_model=List[SecteurInfo])
def lister_secteurs(current_user: Utilisateur = Depends(get_current_user)):
    return secteurs_disponibles()
