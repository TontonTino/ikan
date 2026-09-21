"""
Service email minimal (fastapi-mail) — fail-safe : un envoi qui échoue est
journalisé, ne lève JAMAIS d'exception vers l'appelant. Cohérent avec le
reste du système : aucun email n'est un point de blocage.

Synchrone par conception : pensé pour être appelé depuis le job planifié
(apscheduler BackgroundScheduler, qui tourne dans un thread séparé de la
boucle asyncio de FastAPI) — asyncio.run() y est donc sûr. Ne pas appeler
directement depuis un handler async déjà dans la boucle événementielle.
"""
import asyncio
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def _smtp_configure() -> bool:
    return bool(settings.MAIL_USERNAME and settings.MAIL_SERVER)


async def _envoyer_async(destinataire: str, sujet: str, corps_html: str) -> None:
    from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType

    config = ConnectionConfig(
        MAIL_USERNAME=settings.MAIL_USERNAME,
        MAIL_PASSWORD=settings.MAIL_PASSWORD,
        MAIL_FROM=settings.MAIL_FROM,
        MAIL_PORT=settings.MAIL_PORT,
        MAIL_SERVER=settings.MAIL_SERVER,
        MAIL_STARTTLS=settings.MAIL_STARTTLS,
        MAIL_SSL_TLS=settings.MAIL_SSL_TLS,
        USE_CREDENTIALS=True,
        VALIDATE_CERTS=True,
    )
    message = MessageSchema(
        subject=sujet,
        recipients=[destinataire],
        body=corps_html,
        subtype=MessageType.html,
    )
    await FastMail(config).send_message(message)


def envoyer_email(destinataire: str, sujet: str, corps_html: str) -> bool:
    """
    Envoie un email HTML. Retourne True si l'envoi a réussi, False sinon —
    ne lève jamais. Si MAIL_USERNAME/MAIL_SERVER ne sont pas configurés,
    échoue silencieusement (log info, pas d'erreur bruyante en développement).
    """
    if not _smtp_configure():
        logger.info(f"[email] SMTP non configuré, envoi ignoré — destinataire={destinataire}, sujet={sujet!r}")
        return False

    try:
        asyncio.run(_envoyer_async(destinataire, sujet, corps_html))
        logger.info(f"[email] Envoyé à {destinataire} — sujet={sujet!r}")
        return True
    except Exception as exc:  # noqa: BLE001 — fail-safe volontaire, jamais d'exception vers l'appelant
        logger.error(f"[email] Échec d'envoi à {destinataire} ({sujet!r}) : {exc}")
        return False
