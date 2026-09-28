"""Module principal des fonctions et configurations transversales."""

from scraping_service.core.exceptions import (
    CheckpointBlockedError,
    ConfigurationError,
    ExtractionError,
    PageNotFoundError,
    RateLimitError,
    SessionExpiredError,
    SessionMissingError,
    TargetValidationError,
    VeilleError,
)
from scraping_service.core.logging import logger, setup_logger

__all__ = [
    "CheckpointBlockedError",
    "ConfigurationError",
    "ExtractionError",
    "PageNotFoundError",
    "RateLimitError",
    "SessionExpiredError",
    "SessionMissingError",
    "TargetValidationError",
    "VeilleError",
    "logger",
    "setup_logger",
]
