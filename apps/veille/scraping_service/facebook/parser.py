"""Convertisseur des réponses JSON de l'API Graph en modèles standardisés FeedbackItem."""

from datetime import datetime
import hashlib
from typing import Any

from scraping_service.base import FeedbackItem
from scraping_service.config import settings


def parse_iso_date(date_str: str | None) -> datetime | None:
    """Parse une date ISO 8601 fournie par Facebook (ex: 2026-09-30T10:15:30+0000)."""
    if not date_str:
        return None
    try:
        # Nettoyage pour format standard ISO
        clean_str = date_str.replace("+0000", "+00:00").replace("Z", "+00:00")
        return datetime.fromisoformat(clean_str)
    except Exception:
        return None


def parse_comment_to_feedback(
    comment: dict[str, Any],
    page_id: str,
    post_id: str,
    post_text: str | None = None,
    include_empty: bool = False,
) -> FeedbackItem | None:
    """Convertit un commentaire Facebook extrait via l'API en FeedbackItem standard."""
    comment_id = comment.get("id", "")
    message = (comment.get("message") or "").strip()
    if not message and not include_empty:
        return None

    author_data = comment.get("from") or {}
    author_id = author_data.get("id")
    author_hash = None
    if author_id and settings.state_secret:
        author_hash = hashlib.sha256(f"{settings.state_secret}:{author_id}".encode("utf-8")).hexdigest()
    author_name = author_data.get("name") if settings.store_author_name else None
    text = message or "[Média ou commentaire sans texte]"
    published_at = parse_iso_date(comment.get("created_time"))
    permalink = comment.get("permalink_url") or f"https://www.facebook.com/{comment_id}"

    return FeedbackItem(
        source="facebook",
        source_id=comment_id,
        target_url=f"https://www.facebook.com/{page_id}",
        author_name=author_name,
        author_hash=author_hash,
        text=text,
        published_at=published_at,
        permalink=permalink,
        raw_text=comment.get("message"),
        metadata={
            "post_id": post_id,
            "post_text_excerpt": (post_text[:120] + "...") if post_text and len(post_text) > 120 else post_text,
            "like_count": comment.get("like_count", 0),
            "user_likes": comment.get("user_likes", False),
        },
    )


def parse_post_to_feedback(post: dict[str, Any], page_id: str) -> FeedbackItem:
    """Convertit une publication Facebook elle-même en FeedbackItem."""
    post_id = post.get("id", "")
    text = post.get("message", "").strip() or "[Publication sans texte / Image]"
    published_at = parse_iso_date(post.get("created_time"))
    permalink = post.get("permalink_url") or f"https://www.facebook.com/{post_id}"

    reactions_summary = post.get("reactions", {}).get("summary", {})
    comments_summary = post.get("comments", {}).get("summary", {})

    return FeedbackItem(
        source="facebook",
        source_id=post_id,
        target_url=f"https://www.facebook.com/{page_id}",
        author_name=None,
        text=text,
        published_at=published_at,
        permalink=permalink,
        raw_text=post.get("message"),
        metadata={
            "type": "post",
            "shares_count": post.get("shares", {}).get("count", 0),
            "total_reactions": reactions_summary.get("total_count", 0),
            "total_comments": comments_summary.get("total_count", 0),
        },
    )
