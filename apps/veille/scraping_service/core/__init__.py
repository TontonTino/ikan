"""Module transversal du service de veille."""

from scraping_service.core.exceptions import (
    ConfigurationError,
    FacebookAPIError,
    PageNotFoundError,
    PermissionDeniedError,
    RateLimitError,
    TargetValidationError,
    TokenExpiredError,
    TokenMissingError,
    VeilleError,
)
from scraping_service.core.logging import logger, setup_logger

__all__ = [
    "ConfigurationError",
    "FacebookAPIError",
    "PageNotFoundError",
    "PermissionDeniedError",
    "RateLimitError",
    "TargetValidationError",
    "TokenExpiredError",
    "TokenMissingError",
    "VeilleError",
    "logger",
    "setup_logger",
]
