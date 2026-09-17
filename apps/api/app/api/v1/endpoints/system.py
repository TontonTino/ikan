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
                "Modifier les paramètres généraux et techniques du système",
                "Consulter tous les dashboards et exporter l'ensemble des données"
            ]
        },
        {
            "role": "cx_manager",
            "nom_affichage": "CX Manager (Siège)",
            "description": "Supervision globale de l'expérience client et pilotage stratégique.",
            "droits": [
                "Consulter les indicateurs et KPIs globaux de l'organisation",
                "Comparer les performances entre toutes les agences rattachées",
                "Consulter les feedbacks et analyses IA (Sentiments & Thématiques)",
                "Consulter les alertes et les recommandations d'actions stratégiques",
                "Consulter les suggestions d'amélioration soumises par les clients",
                "Exporter les rapports et synthèses périodiques"
            ]
        },
        {
            "role": "agency_manager",
            "nom_affichage": "Responsable d'Agence",
            "description": "Suivi et gestion opérationnelle de l'expérience client au niveau agence.",
            "droits": [
                "Consulter les feedbacks et notes attribués à son agence",
                "Recevoir et traiter les alertes de satisfaction de son agence",
                "Consulter les recommandations d'actions correctives de son agence",
                "Mettre à jour le statut des suggestions rattachées à son agence",
                "Gérer les demandes de recontact client"
            ]
        }
    ]
