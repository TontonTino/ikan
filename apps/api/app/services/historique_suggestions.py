"""
Historique des changements de statut d'une suggestion (AM-08) : lecture et règle de transition.

Le périmètre n'est PAS décidé ici : l'appelant (app/api/v1/endpoints/suggestions.py) vérifie l'accès à la suggestion avec
`verifier_acces_agence(…, agence_id_de_la_suggestion(…))` (app/services/suggestions_scope.py, suggestions sans feedback comprises) AVANT
d'appeler ces fonctions, qui ne reçoivent que des identifiants de suggestions déjà autorisées.

Ce qui sort : ancien et nouveau statut, date, nom et rôle de l'auteur, commentaire. Jamais un identifiant d'utilisateur, un e-mail, un
téléphone, ni rien de la demande de contact du client. Le commentaire est du texte libre saisi par un membre de l'équipe : ses éventuels
numéros et e-mails sont masqués à la sortie (app/utils/masquage.py).
"""
from collections import defaultdict
from typing import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.enums import IdeaStatus
from app.models.suggestion import HistoriqueSuggestion
from app.models.utilisateur import Utilisateur
from app.schemas.suggestion import HistoriqueSuggestionResponse
from app.utils.masquage import masquer_contacts

MESSAGE_RETOUR_A_NOUVEAU = (
    "Une suggestion ne peut pas revenir au statut « Nouveau ». Pour la rouvrir, choisissez « En cours »."
)


def transition_interdite(ancien: IdeaStatus, nouveau: IdeaStatus) -> bool:
    """Seule règle : on ne revient jamais à « Nouveau » depuis un autre statut. Tout le reste est permis, y compris rouvrir une
    suggestion traitée ou rejetée (vers « En cours »). Un changement vers le même statut n'est pas une transition (aucune entrée)."""
    return nouveau == IdeaStatus.NOUVEAU and ancien != IdeaStatus.NOUVEAU


def _vers_reponse(entree: HistoriqueSuggestion, prenom: str | None, nom: str | None, role) -> HistoriqueSuggestionResponse:
    auteur = f"{prenom} {nom}".strip() if (prenom or nom) else None
    return HistoriqueSuggestionResponse(
        id=entree.id,
        ancien_statut=entree.ancien_statut,
        nouveau_statut=entree.nouveau_statut,
        date=entree.date_action,
        auteur_nom=auteur,
        auteur_role=role.value if role is not None else None,
        commentaire=masquer_contacts(entree.commentaire) or None,
    )


def historiques_par_suggestion(db: Session, suggestion_ids: Iterable[UUID]) -> dict[UUID, list[HistoriqueSuggestionResponse]]:
    """Historique de chaque suggestion, du plus ancien au plus récent (ordre chronologique), en deux requêtes au plus."""
    ids = list(suggestion_ids)
    if not ids:
        return {}
    lignes = (
        db.query(HistoriqueSuggestion, Utilisateur.prenom, Utilisateur.nom, Utilisateur.role)
        .outerjoin(Utilisateur, Utilisateur.id == HistoriqueSuggestion.utilisateur_id)
        .filter(HistoriqueSuggestion.suggestion_id.in_(ids))
        .order_by(HistoriqueSuggestion.date_action.asc(), HistoriqueSuggestion.id.asc())
        .all()
    )
    resultat: dict[UUID, list[HistoriqueSuggestionResponse]] = defaultdict(list)
    for entree, prenom, nom, role in lignes:
        resultat[entree.suggestion_id].append(_vers_reponse(entree, prenom, nom, role))
    return resultat


def dernier_changement_par_suggestion(db: Session, suggestion_ids: Iterable[UUID]) -> dict[UUID, HistoriqueSuggestionResponse]:
    """Dernier changement de statut de chaque suggestion qui en a un."""
    return {sid: entrees[-1] for sid, entrees in historiques_par_suggestion(db, suggestion_ids).items() if entrees}
