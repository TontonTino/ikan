"""
Traitement d'une demande de rappel — POINT UNIQUE (AM-07).

Deux gestes mènent à « recontactée » : le bouton « Marquer comme recontacté » et l'enregistrement d'une réponse au client.
Les deux passent ici, pour que la date, l'auteur et l'événement d'historique soient TOUJOURS enregistrés ensemble.

Le traitement est définitif : une fois la demande traitée, le téléphone et l'e-mail du client ne sont plus renvoyés par l'API
(voir DemandeContactInfo._masquer_si_traitee). Il n'existe pas de réouverture dans cette version.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.demande_contact import DemandeContact
from app.models.historique_feedback import HistoriqueFeedback
from app.models.utilisateur import Utilisateur

TYPE_EVENEMENT_RECONTACT = "demande_recontactee"
# Seuls ces canaux sont repris dans l'historique : le canal d'une réponse est un texte libre côté API, il ne doit jamais y
# introduire de coordonnées.
_CANAUX_CONNUS = {"telephone": "téléphone", "email": "e-mail", "whatsapp": "WhatsApp", "sms": "SMS"}


def _details(origine: str, canal: Optional[str]) -> str:
    if origine == "reponse":
        libelle = _CANAUX_CONNUS.get((canal or "").lower())
        return f"Client recontacté (réponse enregistrée{' par ' + libelle if libelle else ''})"
    return "Client recontacté (bouton « Marquer comme recontacté »)"


def marquer_recontactee(db: Session, demande: DemandeContact, utilisateur: Utilisateur, *, origine: str, canal: Optional[str] = None) -> bool:
    """Marque la demande comme recontactée. Retourne True si CE appel l'a traitée, False si elle l'était déjà.

    - UPDATE conditionnel (`traitee IS NOT TRUE`) : un double clic ou deux appels simultanés n'écrivent qu'UNE date, UN auteur
      et UN événement ; la date et l'auteur d'origine ne sont jamais écrasés.
    - L'événement d'historique ne contient aucune coordonnée du client.
    - Ne commite pas : l'appelant commite (le traitement et, le cas échéant, la réponse enregistrée sont atomiques).
    """
    traitee = (
        db.query(DemandeContact)
        .filter(DemandeContact.id == demande.id, or_(DemandeContact.traitee.is_(None), DemandeContact.traitee.is_(False)))
        .update(
            {
                DemandeContact.traitee: True,
                DemandeContact.date_traitement: datetime.now(timezone.utc),
                DemandeContact.traitee_par_id: utilisateur.id,
            },
            synchronize_session=False,
        )
    )
    if not traitee:
        return False

    feedback = demande.feedback
    agence = feedback.qr_code.agence if feedback is not None and feedback.qr_code is not None else None
    db.add(HistoriqueFeedback(
        feedback_id=demande.feedback_id,
        utilisateur_id=utilisateur.id,
        auteur_nom=f"{utilisateur.prenom} {utilisateur.nom}",
        auteur_role=utilisateur.role.value,
        agence_nom=agence.nom if agence is not None else None,
        agence_id=feedback.qr_code.agence_id if feedback is not None and feedback.qr_code is not None else None,
        type_evenement=TYPE_EVENEMENT_RECONTACT,
        ancien_statut=feedback.statut_traitement if feedback is not None else None,
        nouveau_statut=feedback.statut_traitement if feedback is not None else None,
        details=_details(origine, canal),
    ))
    db.flush()
    db.refresh(demande)  # relit traitee / date_traitement / traitee_par_id écrits par l'UPDATE
    return True
