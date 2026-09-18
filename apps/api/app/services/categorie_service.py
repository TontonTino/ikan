"""
Service catégories — résolution des catégories actives d'une agence.
Garantit qu'une agence a toujours au moins une catégorie utilisable sur le
formulaire client, même si le CX Manager n'en a pas encore défini (BF-XX).
"""
import uuid
from sqlalchemy.orm import Session

from app.models.categorie import Categorie

CATEGORIE_DEFAUT_NOM = "Général"


def get_or_create_categories_actives(agence_id: uuid.UUID, db: Session) -> list[Categorie]:
    """
    Retourne les catégories actives d'une agence. Si aucune n'existe encore,
    crée automatiquement une catégorie "Général" pour ne jamais bloquer le
    formulaire de feedback client — le CX Manager est invité à la remplacer
    par ses propres catégories dès que possible.
    """
    categories = (
        db.query(Categorie)
        .filter(Categorie.agence_id == agence_id, Categorie.active == True)
        .order_by(Categorie.created_at.asc())
        .all()
    )
    if categories:
        return categories

    default = Categorie(id=uuid.uuid4(), agence_id=agence_id, nom=CATEGORIE_DEFAUT_NOM, active=True)
    db.add(default)
    db.commit()
    db.refresh(default)
    return [default]
