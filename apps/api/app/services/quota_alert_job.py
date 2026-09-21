"""
Job planifié (quotidien) : alertes de quota par email à 80% et 100%
d'utilisation. Réutilise le MÊME scheduler que la dégradation automatique
des paiements (Phase 2) — voir la planification dans app/main.py.

Fail-safe à deux niveaux :
- une organisation en erreur (calcul, email) n'empêche jamais les suivantes
  d'être traitées ;
- un échec d'envoi email (SMTP injoignable, credentials invalides) est
  journalisé et n'écrit PAS dans alertes_quota_envoyees, pour que l'alerte
  soit retentée au prochain cycle plutôt que silencieusement perdue.

Anti-spam : une alerte n'est envoyée qu'une fois par
(organisation, métrique, seuil, cycle de facturation) — voir
alertes_quota_envoyees. Le cycle est le mois calendaire courant : le
compteur repart à zéro chaque mois plutôt que de bloquer l'alerte pour
toujours après le premier envoi.
"""
import logging
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.alerte_quota_envoyee import AlerteQuotaEnvoyee
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.services.email_service import envoyer_email
from app.services.plan_service import utilisation_organisation

logger = logging.getLogger(__name__)

# clé dans le dict retourné par utilisation_organisation() -> (code métrique stocké
# en base, libellé affiché dans l'email)
METRIQUES = {
    "feedbacks_ce_mois": ("feedbacks", "Feedbacks ce mois-ci"),
    "agences": ("agences", "Agences"),
    "cx_managers": ("cx_managers", "CX Managers"),
}


def _debut_cycle() -> date:
    """Premier jour du mois calendaire courant — l'anti-spam repart à zéro chaque mois."""
    return datetime.now(timezone.utc).date().replace(day=1)


def _deja_envoyee(db: Session, organisation_id, metrique: str, seuil: int, cycle: date) -> bool:
    return db.query(AlerteQuotaEnvoyee).filter(
        AlerteQuotaEnvoyee.organisation_id == organisation_id,
        AlerteQuotaEnvoyee.metrique == metrique,
        AlerteQuotaEnvoyee.seuil == seuil,
        AlerteQuotaEnvoyee.cycle_facturation_debut == cycle,
    ).first() is not None


def _destinataires_cx_manager(db: Session, organisation_id) -> list[str]:
    utilisateurs = db.query(Utilisateur).filter(
        Utilisateur.organisation_id == organisation_id,
        Utilisateur.role == UserRole.CX_MANAGER,
        Utilisateur.active == True,  # noqa: E712
    ).all()
    return [u.email for u in utilisateurs if u.email]


def _construire_email(org_nom: str, libelle_metrique: str, actuel: int, max_: int, seuil: int) -> tuple[str, str]:
    pourcentage = round(actuel / max_ * 100) if max_ else 0
    if seuil >= 100:
        sujet = f"Quota atteint — {libelle_metrique} ({org_nom})"
        intro = f"Le quota <strong>{libelle_metrique}</strong> de votre forfait est atteint."
    else:
        sujet = f"Quota bientôt atteint — {libelle_metrique} ({org_nom})"
        intro = f"Le quota <strong>{libelle_metrique}</strong> de votre forfait approche de sa limite."

    corps_html = f"""
    <p>Bonjour,</p>
    <p>{intro}</p>
    <p><strong>{org_nom}</strong> a utilisé <strong>{actuel} / {max_}</strong> ({pourcentage}%) — {libelle_metrique}.</p>
    <p>
      Consultez le détail ou changez de forfait depuis le dashboard :<br>
      <a href="{settings.PUBLIC_DASHBOARD_URL}">{settings.PUBLIC_DASHBOARD_URL}</a>
    </p>
    <p>— IKAN AI</p>
    """
    return sujet, corps_html


def _traiter_organisation(db: Session, org: Organisation, cycle: date) -> None:
    utilisation = utilisation_organisation(db, org.id)
    if not utilisation.get("plan"):
        return  # organisation sans forfait connu : rien à surveiller

    for cle_utilisation, (metrique, libelle) in METRIQUES.items():
        quota = utilisation.get(cle_utilisation)
        if not quota or quota.get("max") is None:
            continue  # illimité : rien à surveiller

        actuel, max_ = quota["actuel"], quota["max"]
        if not max_ or max_ <= 0:
            continue
        ratio = actuel / max_

        if ratio >= 1.0:
            seuil = 100
        elif ratio >= 0.8:
            seuil = 80
        else:
            continue

        if _deja_envoyee(db, org.id, metrique, seuil, cycle):
            continue

        destinataires = _destinataires_cx_manager(db, org.id)
        if not destinataires:
            logger.info(f"[alertes quota] Aucun CX Manager actif pour l'organisation {org.id}, alerte {metrique}@{seuil} ignorée")
            continue

        sujet, corps_html = _construire_email(org.nom, libelle, actuel, max_, seuil)
        au_moins_un_envoi_reussi = False
        for email in destinataires:
            if envoyer_email(email, sujet, corps_html):
                au_moins_un_envoi_reussi = True

        # N'enregistre que si au moins un envoi a réellement réussi : un échec
        # SMTP total ne doit pas être confondu avec une alerte traitée, sinon
        # elle ne serait plus jamais retentée pour ce cycle.
        if au_moins_un_envoi_reussi:
            db.add(AlerteQuotaEnvoyee(
                organisation_id=org.id, metrique=metrique, seuil=seuil, cycle_facturation_debut=cycle,
            ))
            db.commit()


def envoyer_alertes_quota() -> None:
    """Point d'entrée du job quotidien (voir la planification dans app/main.py)."""
    db: Session = SessionLocal()
    try:
        organisations = db.query(Organisation).filter(Organisation.active == True).all()  # noqa: E712
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[alertes quota] Impossible de lister les organisations, job abandonné : {exc}")
        db.close()
        return

    cycle = _debut_cycle()

    for org in organisations:
        try:
            _traiter_organisation(db, org, cycle)
        except Exception as exc:  # noqa: BLE001 — une organisation en erreur ne bloque jamais les suivantes
            logger.error(f"[alertes quota] Erreur pour l'organisation {org.id}, poursuite avec les suivantes : {exc}")
            db.rollback()

    db.close()
