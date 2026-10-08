"""Moteur unifié de collecte et d'extraction de veille Facebook via Meta Graph API."""

import asyncio
from datetime import datetime
import re
from typing import Any
from urllib.parse import parse_qs, urlparse

from scraping_service.base import FeedbackItem, SourceScraper
from scraping_service.core.exceptions import (
    FacebookAPIError,
    PermissionDeniedError,
    RateLimitError,
    TargetValidationError,
    TokenExpiredError,
)
from scraping_service.core.logging import log_event, logger
from scraping_service.core.state import ScrapeStateStore
from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.parser import parse_comment_to_feedback


def deduplicate_feedback_items(items: list[FeedbackItem]) -> list[FeedbackItem]:
    """Supprime les doublons de feedback en fonction de l'identifiant source."""
    seen: set[str] = set()
    unique_items: list[FeedbackItem] = []

    for item in items:
        key = item.source_id or f"{item.text}:{item.published_at}"
        if key in seen:
            continue
        seen.add(key)
        unique_items.append(item)

    return unique_items


def extract_page_identifier(target: str) -> str:
    """Extrait l'identifiant ou le username de la page à partir d'une URL ou d'un ID brut.

    Exemples acceptés :
      - '1618870513365355' -> '1618870513365355'
      - 'https://www.facebook.com/IKAN.AI' -> 'IKAN.AI'
      - 'https://facebook.com/profile.php?id=123456789' -> '123456789'
    """
    target = target.strip()
    if not target:
        raise TargetValidationError("L'identifiant ou l'URL de la cible Facebook est vide.")

    # Si c'est un identifiant numérique pur ou username sans slash
    if re.match(r"^[a-zA-Z0-9._-]+$", target):
        return target

    # Si c'est une URL
    try:
        parsed = urlparse(target)
        if not parsed.scheme:
            parsed = urlparse("https://" + target)

        if "facebook.com" not in (parsed.netloc or ""):
            raise TargetValidationError(f"L'URL cible doit pointer vers facebook.com (reçu: {parsed.netloc})")

        path = parsed.path.strip("/")
        if "profile.php" in path:
            qs = parse_qs(parsed.query)
            if "id" in qs:
                return qs["id"][0]

        parts = [p for p in path.split("/") if p and p not in {"pages", "pg", "groups"}]
        if parts:
            return parts[-1]

    except Exception as exc:
        raise TargetValidationError(f"Impossible d'extraire l'identifiant Facebook de '{target}': {exc}")

    raise TargetValidationError(f"Format d'URL ou d'identifiant Facebook non reconnu : {target}")


class FacebookCollector(SourceScraper):
    """Moteur unifié de collecte et d'extraction de veille Facebook via Meta Graph API."""

    source = "facebook"

    def __init__(
        self,
        client: FacebookGraphClient | None = None,
        max_retries: int = 3,
        state_store: ScrapeStateStore | None = None,
    ):
        self.client = client or FacebookGraphClient()
        self.max_retries = max_retries
        self.state_store = state_store or ScrapeStateStore()

    async def collect_page_feedback(
        self,
        page_id: str,
        limit_posts: int = 25,
        max_comments_per_post: int = 100,
        max_items: int = 1000,
        since: datetime | None = None,
    ) -> tuple[list[FeedbackItem], list[str]]:
        """Collecte les retours d'une Page avec gestion unifiée des erreurs partielles."""
        errors: list[str] = []
        feedback_items: list[FeedbackItem] = []

        fetch_kwargs: dict[str, Any] = {"page_id": page_id, "limit": limit_posts}
        if since is not None:
            fetch_kwargs["since"] = since
        try:
            posts = await self.client.fetch_page_posts(**fetch_kwargs)
        except TypeError:
            posts = await self.client.fetch_page_posts(page_id=page_id, limit=limit_posts)
        for post in posts:
            if len(feedback_items) >= max_items:
                break
            post_id = post.get("id")
            if not isinstance(post_id, str):
                errors.append("invalid_post")
                continue
            post_text = post.get("message")
            remaining = max_items - len(feedback_items)

            try:
                comments = await self.client.fetch_post_comments(
                    post_id=post_id,
                    max_comments=min(max_comments_per_post, remaining),
                )
            except (RateLimitError, TokenExpiredError, PermissionDeniedError):
                raise
            except FacebookAPIError:
                errors.append("comments_unavailable")
                continue
            except Exception as exc:
                errors.append(f"comments_error:{exc}")
                continue

            for comment in comments:
                if not isinstance(comment.get("id"), str) or not comment.get("id"):
                    errors.append("invalid_comment")
                    continue
                item = parse_comment_to_feedback(
                    comment=comment,
                    page_id=page_id,
                    post_id=post_id,
                    post_text=post_text,
                )
                if item is not None:
                    feedback_items.append(item)
                if len(feedback_items) >= max_items:
                    break

        return feedback_items, errors

    async def fetch(self, target: str, max_items: int = 50) -> list[FeedbackItem]:
        """Extrait les commentaires d'une cible avec déduplication et persistance d'état."""
        page_id = extract_page_identifier(target)
        log_event(logger, "info", "facebook_scrape_start", target=page_id, max_items=max_items)

        items: list[FeedbackItem] = []
        for attempt in range(1, self.max_retries + 1):
            try:
                items, _ = await self.collect_page_feedback(
                    page_id=page_id,
                    limit_posts=15,
                    max_comments_per_post=100,
                    max_items=max_items,
                )
                break
            except RateLimitError as exc:
                if attempt >= self.max_retries:
                    raise
                wait_time = 2 ** attempt
                log_event(logger, "warning", "facebook_rate_limit_retry", attempt=attempt, wait_seconds=wait_time)
                await asyncio.sleep(wait_time)
            except TokenExpiredError:
                raise

        deduped_items = deduplicate_feedback_items(items)
        persisted_items = self.state_store.filter_new(page_id, deduped_items)
        self.state_store.record_run(page_id, deduped_items)
        log_event(
            logger,
            "info",
            "facebook_scrape_end",
            target=page_id,
            collected_count=len(items),
            deduplicated_count=len(deduped_items),
            persisted_count=len(persisted_items),
        )
        return persisted_items[:max_items]


# Alias rétrocompatible
FacebookScraper = FacebookCollector
