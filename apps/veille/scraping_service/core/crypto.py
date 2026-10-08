"""Chiffrement réversible des jetons persistés sur disque."""

from collections.abc import Sequence

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from scraping_service.config import settings
from scraping_service.core.exceptions import ConfigurationError


def _cipher(keys: str | Sequence[str] | None = None) -> MultiFernet:
    configured = keys if keys is not None else settings.token_encryption_key
    key_list = [key.strip() for key in configured.split(",") if key.strip()] if isinstance(configured, str) else list(configured)
    if not key_list:
        raise ConfigurationError("VEILLE_TOKEN_ENCRYPTION_KEY est nécessaire au stockage des jetons.")
    try:
        return MultiFernet([Fernet(key.encode("ascii")) for key in key_list])
    except (ValueError, UnicodeEncodeError) as exc:
        raise ConfigurationError("La clé de chiffrement des jetons n'est pas une clé Fernet valide.") from exc


def encrypt_token(token: str, keys: str | Sequence[str] | None = None) -> str:
    """Chiffre un jeton avec la première clé configurée."""
    if not token:
        raise ValueError("Le jeton à chiffrer ne peut pas être vide.")
    return _cipher(keys).encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(token_encrypted: str, keys: str | Sequence[str] | None = None) -> str:
    """Déchiffre un jeton chiffré avec l'une des clés de rotation."""
    try:
        return _cipher(keys).decrypt(token_encrypted.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ConfigurationError("Le jeton stocké ne peut pas être déchiffré avec les clés configurées.") from exc