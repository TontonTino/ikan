"""Exceptions personnalisées pour le service de veille et scraping."""

class VeilleError(Exception):
    """Exception de base pour toutes les erreurs du service de veille."""
    def __init__(self, message: str, error_code: str = "VEILLE_ERROR", details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.details = details or {}


class ConfigurationError(VeilleError):
    """Erreur de configuration (variables d'environnement, chemins, etc.)."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, error_code="CONFIG_ERROR", details=details)


class SessionMissingError(VeilleError):
    """Fichier de session introuvable."""
    def __init__(self, message: str = "Aucune session enregistrée trouvée.", details: dict | None = None):
        super().__init__(message, error_code="SESSION_MISSING", details=details)


class SessionExpiredError(VeilleError):
    """Session existante expirée ou rejetée par le réseau social."""
    def __init__(self, message: str = "La session est expirée ou invalide. Ré-authentification requise.", details: dict | None = None):
        super().__init__(message, error_code="SESSION_EXPIRED", details=details)


class CheckpointBlockedError(VeilleError):
    """Compte ou navigation bloqué par un contrôle de sécurité (Captcha, 2FA, Checkpoint)."""
    def __init__(self, message: str = "Navigation bloquée par un contrôle de sécurité (checkpoint Facebook).", details: dict | None = None):
        super().__init__(message, error_code="CHECKPOINT_BLOCKED", details=details)


class RateLimitError(VeilleError):
    """Requêtes bloquées pour cause de limite de débit (Rate Limit / Too Many Requests)."""
    def __init__(self, message: str = "Trop de requêtes détectées par la plateforme.", details: dict | None = None):
        super().__init__(message, error_code="RATE_LIMITED", details=details)


class TargetValidationError(VeilleError):
    """L'URL cible fournie est invalide pour ce scraper."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, error_code="INVALID_TARGET", details=details)


class PageNotFoundError(VeilleError):
    """La page Facebook cible n'existe pas ou n'est plus accessible publiquement."""
    def __init__(self, message: str = "La page Facebook cible n'existe pas ou n'est pas accessible.", details: dict | None = None):
        super().__init__(message, error_code="PAGE_NOT_FOUND", details=details)


class ExtractionError(VeilleError):
    """Échec lors de l'extraction des publications de la page."""
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message, error_code="EXTRACTION_FAILED", details=details)
