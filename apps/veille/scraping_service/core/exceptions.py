"""Exceptions personnalisées pour le service de veille et l'API Facebook Graph."""

class VeilleError(Exception):
    """Exception de base pour toutes les erreurs du service de veille."""
    def __init__(self, message: str, error_code: str = "VEILLE_ERROR", details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}


class ConfigurationError(VeilleError):
    """Erreur de configuration (variables d'environnement, clés manquantes)."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, error_code="CONFIG_ERROR", details=details)


class TokenMissingError(VeilleError):
    """Token d'accès Meta manquant."""
    def __init__(self, message: str = "Aucun jeton d'accès (Access Token) Facebook configuré.", details: dict | None = None):
        super().__init__(message, error_code="TOKEN_MISSING", details=details)


class TokenExpiredError(VeilleError):
    """Jeton d'accès Meta expiré ou invalidé."""
    def __init__(self, message: str = "Le jeton d'accès Facebook est expiré ou invalide.", details: dict | None = None):
        super().__init__(message, error_code="TOKEN_EXPIRED", details=details)


class PermissionDeniedError(VeilleError):
    """Permissions insuffisantes sur l'API Graph (ex: pages_read_user_content manquant)."""
    def __init__(self, message: str = "Permissions insuffisantes pour accéder à cette ressource Facebook.", details: dict | None = None):
        super().__init__(message, error_code="PERMISSION_DENIED", details=details)


class RateLimitError(VeilleError):
    """Limite de requêtes atteinte sur l'API Graph."""
    def __init__(self, message: str = "Limite d'appels API Meta Graph atteinte (Rate limit).", details: dict | None = None):
        super().__init__(message, error_code="RATE_LIMITED", details=details)


class TargetValidationError(VeilleError):
    """L'identifiant ou l'URL de la cible Facebook est invalide."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, error_code="INVALID_TARGET", details=details)


class PageNotFoundError(VeilleError):
    """La page Facebook cible n'existe pas ou n'est pas accessible avec ce token."""
    def __init__(self, message: str = "La page Facebook cible n'existe pas ou n'est pas accessible.", details: dict | None = None):
        super().__init__(message, error_code="PAGE_NOT_FOUND", details=details)


class FacebookAPIError(VeilleError):
    """Erreur générale renvoyée par l'API Meta Graph."""
    def __init__(self, message: str, error_code: str = "FB_API_ERROR", details: dict | None = None):
        super().__init__(message, error_code=error_code, details=details)
