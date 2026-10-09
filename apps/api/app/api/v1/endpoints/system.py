"""
Endpoints Système — Paramètres globaux & Matrice des Rôles/Permissions.
"""
from typing import Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_active_user, get_db
from app.models.utilisateur import Utilisateur
from app.models.system_settings import SystemSettings
from app.schemas.system_settings import SystemSettingsResponse, SystemSettingsUpdate

router = APIRouter()


def _get_or_create_settings(db: Session) -> SystemSettings:
    """Récupère ou initialise les paramètres système s'ils n'existent pas encore."""
    settings_obj = db.query(SystemSettings).first()
    if not settings_obj:
        settings_obj = SystemSettings()
        db.add(settings_obj)
        db.commit()
        db.refresh(settings_obj)
    return settings_obj


@router.get("/settings", response_model=SystemSettingsResponse)
def get_system_settings(
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_current_active_user),
):
    """Récupère la configuration actuelle du système (Tout utilisateur connecté)."""
    return _get_or_create_settings(db)


@router.patch("/settings", response_model=SystemSettingsResponse)
def update_system_settings(
    data: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_admin_user),
):
    """Met à jour la configuration générale de la plateforme (Admin uniquement)."""
    settings_obj = _get_or_create_settings(db)
    
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(settings_obj, field, value)

    db.commit()
    db.refresh(settings_obj)
    return settings_obj


@router.get("/permissions", response_model=List[Dict[str, Any]])
def get_roles_permissions(
    _: Utilisateur = Depends(get_current_active_user),
):
    """
    Retourne la matrice explicite des rôles et permissions de la plateforme IKAN AI.
    """
    return [
        {
            "role": "admin",
            "nom_affichage": "Administrateur",
            "description": "Accès global et configuration complète de la plateforme.",
            "droits": [
                "Créer, modifier et supprimer des organisations",
                "Créer, modifier, désactiver et supprimer des agences",
                "Créer, modifier et désactiver des comptes utilisateurs",
                "Configurer les seuils d'alerte de satisfaction par agence",
                "Enregistrer les paramètres généraux de la plateforme",
                "Consulter la vue structurelle de la plateforme (organisations, agences, comptes, forfaits) — aucun accès aux données clients ni aux statistiques de satisfaction"
            ]
        },
        {
            "role": "cx_manager",
            "nom_affichage": "CX Manager (siège)",
            "description": "Suit l'expérience client de toutes les agences de son organisation.",
            "droits": [
                "Consulter les indicateurs de l'organisation et comparer les agences",
                "Consulter les avis clients de toutes les agences et leur analyse automatique (ton, gravité)",
                "Créer et suivre des problèmes à traiter et des actions à mener",
                "Consulter les alertes, les suggestions des clients et les demandes de rappel",
                "Gérer les agences, leurs QR codes et les comptes des responsables d'agence",
                "Consulter la veille des réseaux sociaux et exporter les statistiques"
            ]
        },
        {
            "role": "agency_manager",
            "nom_affichage": "Responsable d'agence",
            "description": "Traite au quotidien les avis clients de son agence.",
            "droits": [
                "Consulter les avis clients de son agence et les prendre en charge",
                "Créer et suivre des problèmes à traiter et des actions à mener pour son agence",
                "Consulter les alertes de satisfaction de son agence",
                "Mettre à jour le statut des suggestions de son agence",
                "Traiter les demandes de rappel des clients"
            ]
        }
    ]
