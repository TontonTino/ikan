"""Parsing des publications et avis visibles sur une page Facebook (standard et mbasic)."""

import asyncio
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from playwright.async_api import Locator, Page, TimeoutError as PlaywrightTimeoutError

from scraping_service.base import FeedbackItem
from scraping_service.core.logging import logger
from scraping_service.facebook.dates import (
    parse_facebook_date,
    parse_timestamp_attribute,
)

# Sélecteurs de conteneurs de publications (web moderne Comet, feed units, et repli mbasic)
BLOCK_SELECTOR = (
    "div[role='article'], "
    "article, "
    "div[data-ft], "
    "div[data-pagelet*='FeedUnit'], "
    "div[data-ad-rendering-role='post']"
)

# Sélecteurs précis du contenu textuel du post (évite d'aspirer les commentaires sous-jacents)
POST_TEXT_SELECTORS = [
    'div[data-ad-comet-preview="message"]',
    'div[data-ad-preview="message"]',
    'div[dir="auto"][style*="text-align"]',
]

# Libellés de boutons et bruits d'interface à ignorer
UI_LABELS = re.compile(
    r"^(j[’']aime|commenter|partager|envoyer|répondre|like|comment|share|reply|"
    r"voir plus|en voir plus|see more|suivre|follow|modifier|supprimer|signaler|"
    r"toutes les réactions|écrire un commentaire\.\.\.|write a comment\.\.\.)$",
    re.IGNORECASE,
)

NOISE_PATTERNS = [
    r"^toutes les r[ée]actions\b",
    r"^·$",
    r"^\d+([.,]\d+)?[\s\u00a0]?[kKmM]?$",
    r"^\d+:\d+\s*/\s*\d+:\d+$",
    r"^nous rencontrons des problèmes pour lire cette vidéo\.?$",
    r"^we're having trouble playing this video\.?$",
    r"^voir d['’]autres commentaires",
    r"^view more comments",
]

# Détection des recommandations et avis ("Avis" / "Reviews")
RECO_POSITIVE = re.compile(r"\b(?:recommande|recommends)\b", re.IGNORECASE)
RECO_NEGATIVE = re.compile(r"\b(?:ne recommande pas|does not recommend|doesn't recommend)\b", re.IGNORECASE)


def _is_ui_line(line: str) -> bool:
    lowered = line.strip().lower()
    return bool(UI_LABELS.match(lowered)) or any(re.search(p, lowered) for p in NOISE_PATTERNS)


def _clean_text(value: str) -> str:
    """Normalise les espaces et retours chariot."""
    return re.sub(r"\s+", " ", value).strip()


def filter_clean_content(raw_text: str) -> str:
    """Nettoie le texte brut en retirant les artefacts de boutons et compteurs Facebook."""
    lines = [line.strip() for line in raw_text.split("\n") if line.strip()]
    cleaned_lines = [line for line in lines if not _is_ui_line(line)]
    return _clean_text(" ".join(cleaned_lines))


# Aliases pour rétrocompatibilité avec les anciens scripts
_filter_clean_content = filter_clean_content
_parse_relative_time = parse_facebook_date


def _remove_truncated_suffix(text: str) -> str:
    """Retire le suffixe ajouté quand Facebook laisse un texte tronqué ou des boutons d'action collés."""
    text = re.sub(r"\s+(?:en voir plus|see more)\s*$", "", text, flags=re.IGNORECASE).strip()
    return re.sub(r"\s+(?:répondre|reply|j[’']aime|like|partager|share|commenter|comment)\s*$", "", text, flags=re.IGNORECASE).strip()


def clean_facebook_url(raw_url: str) -> str:
    """Supprime les paramètres de tracking Facebook (fbclid, __tn__, ref, notif_id, etc.)."""
    parsed = urlparse(raw_url)
    tracking_params = {
        "__tn__", "__cft__", "ref", "refid", "fbclid",
        "notif_id", "notif_t", "set", "type", "source"
    }
    filtered_params = [
        (k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k not in tracking_params and not k.startswith("__")
    ]
    cleaned_query = urlencode(filtered_params)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, cleaned_query, ""))


def generate_source_id(permalink: str | None, text: str) -> str:
    """Génère un identifiant unique reproductible pour un élément extrait."""
    value = permalink or text
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def detect_review_rating(header_text: str) -> tuple[float | None, str | None]:
    """Détecte si le post est un avis/recommandation et extrait la note correspondante."""
    if RECO_NEGATIVE.search(header_text):
        return 1.0, "not_recommended"
    if RECO_POSITIVE.search(header_text):
        return 5.0, "recommended"

    # Vérification des étoiles (ex. "5 sur 5", "4 étoiles sur 5")
    star_match = re.search(r"(\d(?:[.,]\d)?)\s*(?:sur|out of|\/)\s*5", header_text, re.IGNORECASE)
    if star_match:
        try:
            return float(star_match.group(1).replace(",", ".")), "star_rating"
        except ValueError:
            pass

    return None, None


async def extract_block_data(block: Locator, page: Page, target_url: str) -> FeedbackItem | None:
    """Extrait les données d'un unique bloc de publication/avis."""
    try:
        raw_text = await block.inner_text(timeout=3_000)
    except PlaywrightTimeoutError:
        return None
    except Exception as exc:
        logger.debug(f"Erreur d'accès inner_text: {exc}")
        return None

    if not raw_text or len(raw_text.strip()) < 15:
        return None

    # 1. Déplier les textes tronqués ("Voir plus" / "See more")
    try:
        see_more = block.locator(
            'div[role="button"]:has-text("Voir plus"), span:has-text("Voir plus"), '
            'div[role="button"]:has-text("See more"), span:has-text("See more")'
        ).first
        if await see_more.count() > 0 and await see_more.is_visible():
            await see_more.click(timeout=800)
            await asyncio.sleep(0.2)
            raw_text = await block.inner_text(timeout=2_000)
    except Exception:
        pass

    # 2. Ciblage prioritaire du corps du message
    isolated_text: str | None = None
    for sel in POST_TEXT_SELECTORS:
        candidate = block.locator(sel).first
        if await candidate.count() > 0:
            try:
                candidate_text = await candidate.inner_text(timeout=500)
                if candidate_text and len(candidate_text.strip()) > 10:
                    isolated_text = candidate_text
                    break
            except Exception:
                continue

    # Fallback au nettoyage global si le conteneur Comet n'est pas présent
    base_text = isolated_text if isolated_text else raw_text
    cleaned_text = _remove_truncated_suffix(filter_clean_content(base_text))
    if len(cleaned_text) < 10:
        cleaned_text = _clean_text(base_text)

    if len(cleaned_text) < 5:
        return None

    # 3. Détection de permalien, timestamp et aria-label de date
    links = block.locator("a[href]")
    permalink: str | None = None
    date_label: str | None = None
    published_at = None

    # Vérification des balises <abbr> ou <time> pour timestamp machine
    try:
        machine_node = block.locator("abbr[data-utime], span[data-utime], time[datetime]").first
        if await machine_node.count() > 0:
            utime = await machine_node.get_attribute("data-utime")
            if utime:
                published_at = parse_timestamp_attribute(utime)
            if not published_at:
                dt_attr = await machine_node.get_attribute("datetime")
                if dt_attr:
                    published_at = parse_facebook_date(dt_attr)
    except Exception:
        pass

    links_count = await links.count()
    for link_idx in range(min(links_count, 15)):
        link = links.nth(link_idx)
        try:
            href = await link.get_attribute("href")
        except Exception:
            continue
        if not href:
            continue

        if any(k in href for k in ["/posts/", "/permalink/", "/reel/", "/videos/", "/photos/", "story_fbid", "fbid="]):
            cleaned_href = clean_facebook_url(href)
            permalink = urljoin(page.url, cleaned_href)

            # Extraction de la date depuis l'attribut aria-label du lien
            aria_label = await link.get_attribute("aria-label")
            link_text = (await link.inner_text()).strip()

            if aria_label and not published_at:
                published_at = parse_facebook_date(aria_label)
                if published_at:
                    date_label = aria_label

            if not published_at and link_text:
                published_at = parse_facebook_date(link_text)
                if published_at:
                    date_label = link_text

            if not date_label and link_text and len(link_text) <= 25:
                date_label = link_text
            break

    # 4. Auteur et lien profil
    author_name: str | None = None
    author_url: str | None = None
    author_candidates = block.locator(
        "h2 a, h3 a, [data-ad-rendering-role='profile_name'] a, "
        "h2 span, h3 span, strong a, a[role='link'] strong"
    )
    if await author_candidates.count() > 0:
        for a_idx in range(await author_candidates.count()):
            cand = author_candidates.nth(a_idx)
            try:
                name_candidate = _clean_text(await cand.inner_text())
                if name_candidate and not _is_ui_line(name_candidate) and len(name_candidate) > 1:
                    author_name = name_candidate
                    cand_href = await cand.get_attribute("href")
                    if cand_href:
                        author_url = urljoin(page.url, clean_facebook_url(cand_href))
                    break
            except Exception:
                continue

    # Repli pour les commentaires et publications courtes ("Auteur · 2 min Message...")
    if not author_name:
        comment_match = re.match(
            r"^([^\n·•]{2,40}?)\s*[·•]\s*(?:(?:\d+\s*(?:min|mn|h|j|d|sem|w)\b|[^\s]+)\s*)?(.*)$",
            raw_text,
            re.DOTALL,
        )
        if comment_match:
            candidate_author = _clean_text(comment_match.group(1))
            body_candidate = _clean_text(comment_match.group(2))
            if candidate_author and not _is_ui_line(candidate_author):
                author_name = candidate_author
                cleaned_body = _remove_truncated_suffix(filter_clean_content(body_candidate))
                if len(cleaned_body) >= 2:
                    cleaned_text = cleaned_body

    # 5. Détection de note / recommandation (Avis)
    rating, reco_status = detect_review_rating(raw_text[:300])

    item_id = generate_source_id(permalink, cleaned_text)

    # 6. Métadonnées enrichies
    metadata: dict[str, Any] = {}
    if date_label:
        metadata["date_label"] = date_label
    if author_url:
        metadata["author_url"] = author_url
    if reco_status:
        metadata["recommendation"] = reco_status

    # Extraction des images attachées (ignorer icônes/emojis)
    images: list[str] = []
    try:
        img_locators = block.locator("img[src*='scontent'], img[src*='fbcdn']")
        img_count = await img_locators.count()
        for img_idx in range(min(img_count, 4)):
            src = await img_locators.nth(img_idx).get_attribute("src")
            if src and "emoji" not in src:
                images.append(src)
    except Exception:
        pass
    if images:
        metadata["images"] = images

    return FeedbackItem(
        source="facebook",
        source_id=item_id,
        target_url=target_url,
        author_name=author_name,
        text=cleaned_text,
        rating=rating,
        published_at=published_at,
        permalink=permalink,
        raw_text=_clean_text(raw_text),
        metadata=metadata,
    )


async def parse_page(
    page: Page,
    target_url: str,
    max_items: int = 20,
    seen_ids: set[str] | None = None,
) -> list[FeedbackItem]:
    """Extrait les blocs de publication et avis d'une page Facebook."""
    seen = seen_ids if seen_ids is not None else set()
    items: list[FeedbackItem] = []

    blocks = page.locator(BLOCK_SELECTOR)
    count = await blocks.count()
    for index in range(count):
        if len(items) >= max_items:
            break

        block = blocks.nth(index)
        item = await extract_block_data(block, page, target_url)
        if not item:
            continue

        if item.source_id in seen:
            continue
        seen.add(item.source_id)
        items.append(item)

    return items


def extract_comet_ssr_items(
    html: str,
    target_url: str,
    max_items: int = 20,
    seen_ids: set[str] | None = None,
) -> list[FeedbackItem]:
    """Extrait les publications et avis directement depuis les payloads JSON SSR de Facebook Comet."""
    seen = set(seen_ids) if seen_ids is not None else set()
    seen_texts: dict[str, FeedbackItem] = {}
    items: list[FeedbackItem] = []

    scripts = re.findall(r'<script[^>]*type="application/json"[^>]*>([\s\S]*?)</script>', html)
    for s in scripts:
        if '"message":' not in s or '"text":' not in s:
            continue
        try:
            data = json.loads(s)
        except Exception:
            continue

        def walk(obj: Any) -> None:
            nonlocal items, seen_texts
            if len(items) >= max_items:
                return

            if isinstance(obj, dict):
                story = obj.get("story")
                if isinstance(story, dict):
                    msg = story.get("message")
                    txt = msg.get("text") if isinstance(msg, dict) else None
                    if txt and len(txt.strip()) > 8:
                        cleaned = _filter_clean_content(txt)
                        if len(cleaned) > 5:
                            perm = story.get("url") or obj.get("url")
                            clean_perm = clean_facebook_url(perm) if perm else None
                            ts = story.get("creation_time") or obj.get("creation_time")
                            pub_at = (
                                datetime.fromtimestamp(ts, tz=timezone.utc)
                                if ts and isinstance(ts, (int, float))
                                else None
                            )
                            actors = story.get("actors") or obj.get("actors") or []
                            author = None
                            if actors and isinstance(actors, list) and isinstance(actors[0], dict):
                                author = actors[0].get("name")

                            # Si ce texte a déjà été vu dans ce lot, enrichir l'existant
                            if cleaned in seen_texts:
                                existing = seen_texts[cleaned]
                                if not existing.permalink and clean_perm:
                                    existing.permalink = clean_perm
                                if not existing.published_at and pub_at:
                                    existing.published_at = pub_at
                                if not existing.author_name and author:
                                    existing.author_name = author
                                return

                            item_id = generate_source_id(clean_perm, cleaned)
                            if item_id not in seen:
                                seen.add(item_id)
                                rating, reco = detect_review_rating(cleaned)
                                meta: dict[str, Any] = {"extracted_from": "comet_ssr"}
                                if reco:
                                    meta["recommendation"] = reco

                                new_item = FeedbackItem(
                                    source="facebook",
                                    source_id=item_id,
                                    target_url=target_url,
                                    author_name=author,
                                    text=cleaned,
                                    rating=rating,
                                    published_at=pub_at,
                                    permalink=clean_perm,
                                    raw_text=_clean_text(txt),
                                    metadata=meta,
                                )
                                seen_texts[cleaned] = new_item
                                items.append(new_item)
                for v in obj.values():
                    walk(v)
            elif isinstance(obj, list):
                for el in obj:
                    walk(el)

        walk(data)

    return items
