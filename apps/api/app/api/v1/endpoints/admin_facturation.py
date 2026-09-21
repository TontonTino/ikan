"""
Supervision Admin de la facturation (Phase 4) — lecture seule (vue d'ensemble,
paiements en échec, historique). Le seul endpoint qui écrit est
PATCH /organisations/{id}/plan (voir organisations.py).

Scope IDENTIQUE au CRUD organisations déjà en place : un Admin ne voit que les
organisations qu'il a créées, plus celles sans créateur connu (données
historiques/seed) — mêmes règles que list_organisations/get_organisation.
"""
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.models.changement_plan import ChangementPlan
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.schemas.facturation import (
    ChangementPlanHistoriqueItem,
    OrganisationPaiementEchoue,
    RepartitionForfait,
    VueEnsembleFacturation,
)
from app.services.plan_catalog import PLAN_GRATUIT_ID, PLAN_PRO_ID, PLAN_STARTER_ID
from app.services.stripe_downgrade_job import PERIODE_GRACE_JOURS

router = APIRouter()


def _scope_admin(current_user: Utilisateur):
    """Même filtre que organisations.py : organisations créées par l'Admin connecté,
    plus celles sans créateur connu (données historiques/seed)."""
    return or_(
        Organisation.created_by_id == current_user.id,
        Organisation.created_by_id.is_(None),
    )


@router.get("/vue-ensemble", response_model=VueEnsembleFacturation)
def vue_ensemble_facturation(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    scope = _scope_admin(current_user)

    # Répartition par forfait : les 4 forfaits sont toujours listés, même à 0.
    plans = db.query(Plan).order_by(Plan.ordre).all()
    plan_ids_orgs = [row[0] for row in db.query(Organisation.plan_id).filter(scope).all()]
    compteur = Counter(plan_ids_orgs)
    repartition = [
        RepartitionForfait(id=p.id, code=p.code, nom=p.nom, nombre=compteur.get(p.id, 0)) for p in plans
    ]

    # Taux de conversion Gratuit -> payant sur 30 jours.
    # numérateur : organisations DISTINCTES (dans le scope) avec un changements_plan
    # ancien=Gratuit -> nouveau=Starter/Pro dans les 30 derniers jours.
    # dénominateur : UNION (pas addition, pour éviter un double-compte si une
    # organisation a basculé puis été rétrogradée dans la même fenêtre) de :
    #   - organisations actuellement sur Gratuit
    #   - organisations converties pendant la fenêtre (donc "Gratuit" à un moment de la fenêtre)
    depuis = datetime.now(timezone.utc) - timedelta(days=30)

    ids_convertis = {
        row[0]
        for row in db.query(ChangementPlan.organisation_id)
        .join(Organisation, Organisation.id == ChangementPlan.organisation_id)
        .filter(
            scope,
            ChangementPlan.ancien_plan_id == PLAN_GRATUIT_ID,
            ChangementPlan.nouveau_plan_id.in_([PLAN_STARTER_ID, PLAN_PRO_ID]),
            ChangementPlan.created_at >= depuis,
        )
        .distinct()
        .all()
    }
    ids_gratuit_actuel = {
        row[0]
        for row in db.query(Organisation.id).filter(scope, Organisation.plan_id == PLAN_GRATUIT_ID).all()
    }
    base_calcul = ids_gratuit_actuel | ids_convertis

    nb_conversions = len(ids_convertis)
    nb_base = len(base_calcul)
    taux = (nb_conversions / nb_base) if nb_base > 0 else None

    return VueEnsembleFacturation(
        repartition=repartition,
        nb_conversions_30j=nb_conversions,
        nb_base_calcul_30j=nb_base,
        taux_conversion_30j=taux,
    )


@router.get("/paiements-echoues", response_model=List[OrganisationPaiementEchoue])
def paiements_echoues(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    scope = _scope_admin(current_user)

    rows = (
        db.query(Organisation, Plan)
        .join(Plan, Plan.id == Organisation.plan_id)
        .filter(scope, Organisation.payment_failed_at.isnot(None))
        .order_by(Organisation.payment_failed_at.asc())  # le plus ancien (proche de la dégradation) en premier
        .all()
    )

    maintenant = datetime.now(timezone.utc)
    resultat = []
    for org, plan in rows:
        payment_failed_at = org.payment_failed_at
        if payment_failed_at.tzinfo is None:
            payment_failed_at = payment_failed_at.replace(tzinfo=timezone.utc)
        echeance = payment_failed_at + timedelta(days=PERIODE_GRACE_JOURS)
        jours_restants = (echeance - maintenant).days
        resultat.append(OrganisationPaiementEchoue(
            organisation_id=org.id,
            organisation_nom=org.nom,
            plan_code=plan.code,
            plan_nom=plan.nom,
            payment_failed_at=org.payment_failed_at,
            jours_restants_avant_degradation=jours_restants,
        ))
    return resultat


@router.get("/historique/{organisation_id}", response_model=List[ChangementPlanHistoriqueItem])
def historique_changements_plan(
    organisation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    org = db.query(Organisation).filter(
        Organisation.id == organisation_id, _scope_admin(current_user)
    ).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")

    lignes = (
        db.query(ChangementPlan)
        .filter(ChangementPlan.organisation_id == organisation_id)
        .order_by(ChangementPlan.created_at.desc())
        .all()
    )

    plans_par_id = {p.id: p for p in db.query(Plan).all()}
    modif_ids = {l.modifie_par_id for l in lignes if l.modifie_par_id}
    utilisateurs_par_id = {
        u.id: u for u in db.query(Utilisateur).filter(Utilisateur.id.in_(modif_ids)).all()
    } if modif_ids else {}

    resultat = []
    for l in lignes:
        ancien = plans_par_id.get(l.ancien_plan_id) if l.ancien_plan_id else None
        nouveau = plans_par_id.get(l.nouveau_plan_id)
        modif = utilisateurs_par_id.get(l.modifie_par_id) if l.modifie_par_id else None
        resultat.append(ChangementPlanHistoriqueItem(
            id=l.id,
            ancien_plan_code=ancien.code if ancien else None,
            ancien_plan_nom=ancien.nom if ancien else None,
            nouveau_plan_code=nouveau.code if nouveau else "?",
            nouveau_plan_nom=nouveau.nom if nouveau else "?",
            raison=l.raison,
            source=l.source,
            modifie_par_nom=f"{modif.prenom} {modif.nom}" if modif else None,
            created_at=l.created_at,
        ))
    return resultat
