import json
import logging
import os
from pathlib import Path
import re
import sys
from typing import Any


class TokenMaskingFilter(logging.Filter):
    """Filtre qui masque les jetons d'accès, en-têtes Bearer et jetons Meta (ex: EAA...)."""

    TOKEN_PATTERNS = [
        (re.compile(r"(access_token=)[^\s&'\"]+", re.IGNORECASE), r"\1[REDACTED]"),
        (re.compile(r"(Bearer\s+)[^\s&'\"]+", re.IGNORECASE), r"\1[REDACTED]"),
        (re.compile(r"\bEAA[A-Za-z0-9]+\b"), "[META_TOKEN_REDACTED]"),
    ]

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            for pattern, repl in self.TOKEN_PATTERNS:
                record.msg = pattern.sub(repl, record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: self._sanitize_value(v) for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple(self._sanitize_value(v) for v in record.args)
        return True

    def _sanitize_value(self, val: Any) -> Any:
        if isinstance(val, str):
            for pattern, repl in self.TOKEN_PATTERNS:
                val = pattern.sub(repl, val)
        return val


def apply_token_masking(target_logger: logging.Logger) -> None:
    """Applique le filtre de masquage de jetons au logger et à tous ses handlers."""
    target_logger.addFilter(TokenMaskingFilter())
    for handler in target_logger.handlers:
        handler.addFilter(TokenMaskingFilter())


def _get_configured_log_level() -> str:
    try:
        from scraping_service.config import settings
        return getattr(settings, "log_level", "INFO")
    except Exception:
        return os.getenv("VEILLE_LOG_LEVEL", "INFO")


def setup_logger(name: str = "veille", level: str | None = None, log_file: Path | None = None) -> logging.Logger:
    """Configure et retourne un logger enrichi et cohérent."""
    logger_instance = logging.getLogger(name)
    resolved_level = (level or _get_configured_log_level()).upper()
    logger_instance.setLevel(getattr(logging, resolved_level, logging.INFO))

    if not logger_instance.handlers:
        formatter = logging.Formatter(
            fmt="%(asctime)s | %(levelname)-7s | [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        console_handler.addFilter(TokenMaskingFilter())
        logger_instance.addHandler(console_handler)

        if log_file:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(str(log_file), encoding="utf-8")
            file_handler.setFormatter(formatter)
            file_handler.addFilter(TokenMaskingFilter())
            logger_instance.addHandler(file_handler)

    apply_token_masking(logger_instance)

    # Applique également aux loggers httpx et uvicorn
    for lib_name in ("httpx", "uvicorn", "uvicorn.access", "uvicorn.error"):
        lib_logger = logging.getLogger(lib_name)
        apply_token_masking(lib_logger)

    return logger_instance


def log_event(logger_inst: logging.Logger, level: str, event: str, **payload: object) -> None:
    """Émet un log structuré en JSON sur la sortie standard du service."""
    message = json.dumps({"event": event, **payload}, ensure_ascii=False, default=str)
    getattr(logger_inst, level.lower(), logger_inst.info)(message)


logger = setup_logger("ikan_veille")

