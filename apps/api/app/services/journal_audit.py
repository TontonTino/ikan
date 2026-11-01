"""
Service UNIQUE d'écriture du journal d'audit (AD-08, SD-13, AD-03) : toutes les actions tracées passent par ici, aucune copie.

Deux façons d'écrire :
 - `journaliser(db, ...)` : SUCCÈS. Ajoute UNE ligne à la session de l'action, sans commit : elle est validée (ou annulée) avec l'action
   elle-même, dans la MÊME transaction. Une action annulée ne laisse donc jamais de ligne de succès.
 - `journaliser_independant(db, ...)` : REFUS et événements d'authentification. Écrit dans une session SÉPARÉE (même moteur) validée
   tout de suite : la ligne survit au refus (qui lève ensuite son erreur). NE LÈVE JAMAIS : si l'écriture échoue (base lente, table
   absente), la réponse de l'appelant est inchangée et l'erreur est journalisée techniquement (type seul, jamais de contenu).

Aucune donnée sensible : `assainir_details` ne laisse passer que des types simples et supprime toute clé évoquant un mot de passe, un
hachage, un jeton, un contact client ou un texte d'avis ; l'adresse IP est tronquée (IPv4 en /24, IPv6 en /48).
"""
import ipaddress
import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import Request
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.journal_audit import JournalAudit
from app.models.utilisateur import Utilisateur

technique = logging.getLogger("ikan.journal_audit")

# ── Codes d'action STABLES (jamais renommés : le tableau de bord et les filtres s'appuient dessus) ─────────────────────────────
ORGANISATION_CREEE = "organisation.creee"
ORGANISATION_MODIFIEE = "organisation.modifiee"
ORGANISATION_DESACTIVEE = "organisation.desactivee"
ORGANISATION_REACTIVEE = "organisation.reactivee"
FORFAIT_MODIFIE = "forfait.modifie"
COMPTE_CREE = "compte.cree"
COMPTE_MODIFIE = "compte.modifie"
COMPTE_SUSPENDU = "compte.suspendu"
COMPTE_ADMIN_CREE = "compte.admin_cree"
AGENCE_CREEE = "agence.creee"
AGENCE_MODIFIEE = "agence.modifiee"
AGENCE_SUPPRIMEE = "agence.supprimee"
QR_SUPPRIME = "qr_code.supprime"
PARAMETRES_MODIFIES = "parametres.modifies"
REFUS_DERNIER_ADMIN = "protection.dernier_admin_refuse"
CONNEXION_ECHOUEE = "auth.connexion_echouee"
CONNEXION_LIMITEE = "auth.connexion_limitee"

CODES_ACTION = (
    ORGANISATION_CREEE, ORGANISATION_MODIFIEE, ORGANISATION_DESACTIVEE, ORGANISATION_REACTIVEE, FORFAIT_MODIFIE, COMPTE_CREE, COMPTE_MODIFIE,
    COMPTE_SUSPENDU, COMPTE_ADMIN_CREE, AGENCE_CREEE, AGENCE_MODIFIEE, AGENCE_SUPPRIMEE, QR_SUPPRIME, PARAMETRES_MODIFIES,
    REFUS_DERNIER_ADMIN, CONNEXION_ECHOUEE, CONNEXION_LIMITEE,
)

ROLE_ANONYME = "anonyme"
ROLE_SYSTEME = "systeme"
COMPTE_INCONNU = "compte inconnu"
FENETRE_CONNEXION = timedelta(minutes=15)

# Toute clé de détails contenant l'un de ces fragments est SUPPRIMÉE (jamais écrite), quelle que soit sa valeur.
FRAGMENTS_INTERDITS = (
    "pass", "mdp", "hash", "token", "jeton", "secret", "cookie", "authorization", "telephone", "phone", "whatsapp", "commentaire",
    "contenu", "texte", "message", "avis", "feedback", "contact", "iban", "carte",
)
LONGUEUR_MAX_TEXTE = 200
PROFONDEUR_MAX = 3
TAILLE_MAX_DETAILS = 2000


def tronquer_ip(adresse: Optional[str]) -> Optional[str]:
    """IPv4 → /24 (« 203.0.113.0 »), IPv6 → /48 (« 2001:db8:abcd:: »). Valeur illisible ou inconnue → None (rien d'inventé)."""
    if not adresse:
        return None
    try:
        ip = ipaddress.ip_address(str(adresse).strip())
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    reseau = ipaddress.ip_network(f"{ip}/{24 if ip.version == 4 else 48}", strict=False)
    return str(reseau.network_address)


def ip_de_requete(requete: Optional[Request]) -> Optional[str]:
    """Adresse du demandeur (même règle que la limitation de débit : X-Forwarded-For jamais cru tel quel), tronquée."""
    if requete is None:
        return None
    from app.core.rate_limit import adresse_ip_client

    try:
        return tronquer_ip(adresse_ip_client(requete))
    except Exception:  # noqa: BLE001 — l'adresse n'est jamais indispensable
        return None


def _valeur_simple(valeur: Any, profondeur: int) -> Any:
    if valeur is None or isinstance(valeur, (bool, int, float)):
        return valeur
    if isinstance(valeur, uuid.UUID):
        return str(valeur)
    if isinstance(valeur, datetime):
        return valeur.isoformat()
    if hasattr(valeur, "value") and isinstance(getattr(valeur, "value"), (str, int)):      # énumérations
        return valeur.value
    if isinstance(valeur, str):
        return valeur[:LONGUEUR_MAX_TEXTE]
    if isinstance(valeur, dict):
        return assainir_details(valeur, profondeur + 1)
    if isinstance(valeur, (list, tuple, set)):
        return [_valeur_simple(v, profondeur + 1) for v in list(valeur)[:50]]
    return None                                                                              # objet inconnu : jamais sa représentation


def assainir_details(details: Optional[dict], profondeur: int = 0) -> Optional[dict]:
    """Détails MINIMAUX : types simples seulement, clés sensibles supprimées, taille bornée."""
    if not details or profondeur >= PROFONDEUR_MAX:
        return None
    propres: dict = {}
    for cle, valeur in details.items():
        nom = str(cle)
        if any(fragment in nom.lower() for fragment in FRAGMENTS_INTERDITS):
            continue
        propres[nom[:60]] = _valeur_simple(valeur, profondeur)
    if profondeur == 0 and len(str(propres)) > TAILLE_MAX_DETAILS:
        return {"tronque": True}
    return propres or None


def _acteur(acteur, role_si_absent: str = ROLE_ANONYME) -> tuple[Optional[uuid.UUID], str, Optional[str]]:
    """(identifiant, rôle, instantané de l'e-mail) d'un compte du personnel ; None → anonyme (ou `role_si_absent`, ex. « systeme »)."""
    if acteur is None:
        return None, role_si_absent, None
    role = getattr(acteur, "role", None)
    return acteur.id, getattr(role, "value", None) or str(role or ROLE_SYSTEME), (getattr(acteur, "email", None) or None)


def _ligne(*, action, acteur, resultat, cible_type, cible_id, cible_libelle, organisation_id, details, requete, role_si_absent=ROLE_ANONYME) -> JournalAudit:
    acteur_id, role, email = _acteur(acteur, role_si_absent)
    return JournalAudit(
        id=uuid.uuid4(), acteur_id=acteur_id, acteur_role=role[:30], acteur_email=(email or None) and email[:255], action=action[:60],
        cible_type=(cible_type or None) and cible_type[:40], cible_id=(str(cible_id)[:64] if cible_id is not None else None),
        cible_libelle=(cible_libelle or None) and str(cible_libelle)[:200], organisation_id=organisation_id, resultat=resultat,
        details=assainir_details(details), adresse_ip=ip_de_requete(requete),
        date_action=datetime.now(timezone.utc),
    )


def journaliser(db: Session, *, action: str, acteur, cible_type: Optional[str] = None, cible_id=None, cible_libelle: Optional[str] = None,
                organisation_id=None, details: Optional[dict] = None, requete: Optional[Request] = None,
                role_si_absent: str = ROLE_ANONYME) -> JournalAudit:
    """SUCCÈS : ajoute UNE ligne à la session de l'action (pas de commit : elle suit le sort de l'action, même transaction)."""
    ligne = _ligne(action=action, acteur=acteur, resultat="succes", cible_type=cible_type, cible_id=cible_id, cible_libelle=cible_libelle,
                   organisation_id=organisation_id, details=details, requete=requete, role_si_absent=role_si_absent)
    db.add(ligne)
    return ligne


# Événements de connexion (échec, limitation) : écrits dans un fil séparé pour ne JAMAIS ralentir la réponse 401/429. Meilleur effort :
# au plus 200 écritures en attente (au-delà, l'événement est abandonné et seule une ligne technique le signale), perte possible à l'arrêt.
EXECUTION_DIFFEREE = True
_ECRIVAINS = ThreadPoolExecutor(max_workers=2, thread_name_prefix="journal-audit")
_EN_ATTENTE = threading.BoundedSemaphore(200)


def _resoudre_compte(session: Session, ligne: JournalAudit, email: str) -> None:
    """Renseigne la cible d'une connexion refusée : le compte (même désactivé) s'il EXISTE, sinon « compte inconnu » SANS la valeur saisie."""
    compte = session.execute(select(Utilisateur.id, Utilisateur.email, Utilisateur.organisation_id).where(func.lower(Utilisateur.email) == email)).first()
    if compte is None:
        ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id = None, None, COMPTE_INCONNU, None
    else:
        ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id = "utilisateur", str(compte[0]), compte[1][:200], compte[2]


def _ecrire(bind, ligne: JournalAudit, dedoublonner: bool, email_a_resoudre: Optional[str] = None) -> bool:
    """Écriture réelle dans une session séparée. Ne lève jamais."""
    try:
        with Session(bind=bind, expire_on_commit=False) as session:
            if session.get_bind().dialect.name == "postgresql":
                session.execute(text("SET LOCAL statement_timeout = 2000"))        # jamais de blocage prolongé
            if email_a_resoudre is not None:
                _resoudre_compte(session, ligne, email_a_resoudre)
            if dedoublonner:
                requete_existant = select(JournalAudit.id).where(
                    JournalAudit.action == ligne.action,
                    JournalAudit.date_action >= ligne.date_action - FENETRE_CONNEXION,
                    JournalAudit.adresse_ip.is_(None) if ligne.adresse_ip is None else JournalAudit.adresse_ip == ligne.adresse_ip,
                    JournalAudit.cible_id.is_(None) if ligne.cible_id is None else JournalAudit.cible_id == ligne.cible_id,
                ).limit(1)
                if session.execute(requete_existant).first() is not None:
                    return False
            session.add(ligne)
            session.commit()
        return True
    except Exception as erreur:  # noqa: BLE001 — jamais d'erreur vers l'appelant, jamais le contenu de l'exception
        technique.error("Écriture du journal d'audit impossible (action=%s, %s)", ligne.action, type(erreur).__name__)
        return False


def _ecrire_differe(bind, ligne: JournalAudit, dedoublonner: bool, email_a_resoudre: Optional[str]) -> None:
    try:
        _ecrire(bind, ligne, dedoublonner, email_a_resoudre)
    finally:
        _EN_ATTENTE.release()


def journaliser_independant(db: Session, *, action: str, acteur, resultat: str = "refus", cible_type: Optional[str] = None, cible_id=None,
                            cible_libelle: Optional[str] = None, organisation_id=None, details: Optional[dict] = None,
                            requete: Optional[Request] = None, dedoublonner_fenetre: bool = False, differe: bool = False,
                            email_a_resoudre: Optional[str] = None) -> bool:
    """REFUS ou événement d'authentification : écrit dans une session SÉPARÉE, validée immédiatement. Ne lève JAMAIS (retourne False si
    rien n'a été écrit ou programmé). `dedoublonner_fenetre` : au plus UNE ligne par (action, adresse tronquée, cible) et par fenêtre de
    15 minutes. `differe` : l'écriture se fait dans un fil séparé (la réponse ne l'attend pas). `email_a_resoudre` : e-mail saisi à une
    connexion ; il n'est JAMAIS écrit tel quel (voir `_resoudre_compte`)."""
    try:
        ligne = _ligne(action=action, acteur=acteur, resultat=resultat, cible_type=cible_type, cible_id=cible_id, cible_libelle=cible_libelle,
                       organisation_id=organisation_id, details=details, requete=requete)
        bind = db.get_bind()
        if differe and EXECUTION_DIFFEREE:
            if not _EN_ATTENTE.acquire(blocking=False):
                technique.error("Journal d'audit saturé : événement abandonné (action=%s)", action)
                return False
            try:
                _ECRIVAINS.submit(_ecrire_differe, bind, ligne, dedoublonner_fenetre, email_a_resoudre)
            except Exception:  # noqa: BLE001
                _EN_ATTENTE.release()
                raise
            return True
        return _ecrire(bind, ligne, dedoublonner_fenetre, email_a_resoudre)
    except Exception as erreur:  # noqa: BLE001
        technique.error("Écriture du journal d'audit impossible (action=%s, %s)", action, type(erreur).__name__)
        return False
