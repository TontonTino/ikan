"""
Protection des administrateurs : il doit toujours rester au moins UN administrateur actif, et un administrateur ne retire jamais
son propre accès par une opération de gestion. Règle UNIQUE, réutilisée par toutes les voies qui peuvent supprimer, désactiver,
rétrograder un compte administrateur ou supprimer l'organisation qui en contient (suppression en cascade des comptes).

Ordre des contrôles dans les routes : authentification, rôle, existence, appartenance, PUIS cette règle (409).
Les refus ne contiennent aucune donnée (ni e-mail, ni identifiant).
"""
from typing import Iterable, Optional
from uuid import UUID

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.services import journal_audit as journal

MESSAGE_DERNIER_ADMIN = "Cette opération retirerait le dernier administrateur actif de la plateforme."
MESSAGE_AUTO_PROTECTION = (
    "Vous ne pouvez pas désactiver, rétrograder ni supprimer votre propre compte administrateur, "
    "ni l'organisation qui le contient."
)


def requete_administrateurs_actifs(db: Session):
    """Administrateurs actifs dont l'ORGANISATION est active (ceux d'une organisation désactivée ne peuvent plus se connecter : ils ne
    comptent plus), triés par identifiant et VERROUILLÉS (FOR UPDATE) : deux opérations simultanées ne peuvent pas retirer chacune
    « l'un des deux derniers » administrateurs. Sans effet sur SQLite (écritures déjà sérialisées)."""
    return (
        db.query(Utilisateur)
        .join(Organisation, Organisation.id == Utilisateur.organisation_id)
        .filter(Utilisateur.role == UserRole.ADMIN, Utilisateur.active == True, Organisation.active == True)  # noqa: E712
        .order_by(Utilisateur.id)
        .with_for_update(of=Utilisateur)
    )


def ids_administrateurs_de_organisation(db: Session, organisation_id: UUID) -> set:
    """Identifiants des comptes administrateurs (actifs ou non) rattachés à l'organisation."""
    lignes = db.query(Utilisateur.id).filter(Utilisateur.organisation_id == organisation_id, Utilisateur.role == UserRole.ADMIN).all()
    return {ligne[0] for ligne in lignes}


def _journaliser_refus(db: Session, acteur: Optional[Utilisateur], motif: str, requete: Optional[Request], cible: Optional[dict]) -> None:
    """Refus tracé dans le journal d'audit : écriture SÉPARÉE (le refus n'est jamais annulé ni retardé par elle, elle ne lève jamais)."""
    cible = cible or {}
    journal.journaliser_independant(
        db, action=journal.REFUS_DERNIER_ADMIN, acteur=acteur, resultat="refus", cible_type=cible.get("type"), cible_id=cible.get("id"),
        cible_libelle=cible.get("libelle"), organisation_id=cible.get("organisation_id"), details={"motif": motif}, requete=requete,
    )


def proteger_administrateurs(db: Session, ids_retires: Iterable[UUID], acteur: Optional[Utilisateur], *, requete: Optional[Request] = None,
                             cible: Optional[dict] = None) -> None:
    """Lève 409 si l'opération retire un administrateur ACTIF et que (a) c'est l'acteur lui-même, ou (b) il ne resterait aucun
    administrateur actif. Un administrateur inactif ne compte pas ; une opération qui ne touche aucun administrateur actif passe.
    Chaque refus est inscrit au journal d'audit (écriture indépendante, voir services/journal_audit.py)."""
    retires = set(ids_retires)
    if not retires:
        return
    actifs = {administrateur.id for administrateur in requete_administrateurs_actifs(db).all()}
    touches = retires & actifs
    if not touches:
        return
    if acteur is not None and acteur.id in touches:
        _journaliser_refus(db, acteur, "auto_protection", requete, cible)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=MESSAGE_AUTO_PROTECTION)
    if not (actifs - retires):
        _journaliser_refus(db, acteur, "dernier_administrateur", requete, cible)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=MESSAGE_DERNIER_ADMIN)


def _cible_compte(compte: Utilisateur) -> dict:
    return {"type": "utilisateur", "id": compte.id, "libelle": compte.email, "organisation_id": compte.organisation_id}


def controler_retrait_compte(db: Session, compte: Utilisateur, acteur: Utilisateur, *, requete: Optional[Request] = None) -> None:
    """À appeler avant de désactiver ou supprimer `compte` (quel que soit son rôle ; ne fait rien s'il n'est pas administrateur)."""
    if compte.role == UserRole.ADMIN:
        proteger_administrateurs(db, {compte.id}, acteur, requete=requete, cible=_cible_compte(compte))


def controler_modification_compte(db: Session, compte: Utilisateur, modifications: dict, acteur: Utilisateur, *,
                                  requete: Optional[Request] = None) -> None:
    """À appeler avant d'appliquer une modification : désactivation (`active=False`) ou changement de rôle d'un administrateur."""
    if compte.role != UserRole.ADMIN:
        return
    desactive = modifications.get("active") is False
    retrograde = "role" in modifications and modifications["role"] != UserRole.ADMIN
    if desactive or retrograde:
        proteger_administrateurs(db, {compte.id}, acteur, requete=requete, cible=_cible_compte(compte))


def controler_desactivation_organisation(db: Session, organisation_id: UUID, acteur: Utilisateur, *, requete: Optional[Request] = None) -> None:
    """À appeler avant de DÉSACTIVER une organisation : ses comptes administrateurs ne pourraient plus se connecter."""
    proteger_administrateurs(
        db, ids_administrateurs_de_organisation(db, organisation_id), acteur, requete=requete,
        cible={"type": "organisation", "id": organisation_id, "organisation_id": organisation_id},
    )
