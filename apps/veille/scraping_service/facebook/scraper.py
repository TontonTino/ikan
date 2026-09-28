"""Scraper Facebook résilient avec défilement incrémental et protection anti-détection."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import Page, async_playwright

from scraping_service.base import FeedbackItem, SourceScraper
from scraping_service.browser.banners import dismiss_banners
from scraping_service.browser.context import create_browser_context
from scraping_service.browser.stealth import CHROMIUM_ARGS
from scraping_service.config import settings
from scraping_service.core.exceptions import (
    CheckpointBlockedError,
    ExtractionError,
    PageNotFoundError,
    SessionExpiredError,
    SessionMissingError,
    TargetValidationError,
)
from scraping_service.core.logging import logger
from scraping_service.facebook.parser import (
    BLOCK_SELECTOR,
    extract_block_data,
    extract_comet_ssr_items,
    parse_page,
)


def normalize_facebook_url(target: str) -> str:
    """Valide et normalise l'URL Facebook cible."""
    if "<" in target or ">" in target:
        raise TargetValidationError(
            f"L'URL cible '{target}' contient des chevrons '<...>'. "
            "Veuillez remplacer le modèle d'exemple par le vrai nom ou identifiant de page Facebook "
            "(ex: https://www.facebook.com/orange.burkina ou https://www.facebook.com/facebook)."
        )

    parsed = urlparse(target)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise TargetValidationError(f"Target '{target}' doit être une URL http(s) valide")

    netloc = parsed.netloc.lower().split(":", 1)[0]
    valid_domains = {"facebook.com", "www.facebook.com", "mbasic.facebook.com", "m.facebook.com", "web.facebook.com"}
    if netloc not in valid_domains:
        raise TargetValidationError(f"Target doit pointer vers facebook.com (reçu: {netloc})")

    return target


def to_mbasic_url(target: str) -> str:
    """Construit l'URL mbasic correspondante."""
    parsed = urlparse(target)
    return parsed._replace(netloc="mbasic.facebook.com").geturl()


async def save_debug_snapshot(page: Page, prefix: str = "fb_snapshot") -> tuple[Path | None, Path | None]:
    """Sauvegarde une capture d'écran et le code source HTML pour le débogage."""
    if not settings.save_debug_artifacts:
        return None, None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    screenshot_path = settings.debug_artifact_path("screenshots", f"{prefix}_{timestamp}.png")
    dump_path = settings.debug_artifact_path("dumps", f"{prefix}_{timestamp}.html")

    try:
        await page.screenshot(path=str(screenshot_path), full_page=False)
        content = await page.content()
        dump_path.write_text(content, encoding="utf-8")
        logger.info(f"Artefacts de débogage sauvegardés : {screenshot_path} | {dump_path}")
        return screenshot_path, dump_path
    except Exception as exc:
        logger.warning(f"Impossible de sauvegarder le snapshot de débogage: {exc}")
        return None, None


class FacebookScraper(SourceScraper):
    source = "facebook"

    async def _check_security_barriers(self, page: Page) -> None:
        """Détecte les checkpoints, captchas, pages introuvables ou redirections de login obligatoire."""
        current_url = page.url.lower()

        if "checkpoint" in current_url:
            await save_debug_snapshot(page, "checkpoint")
            raise CheckpointBlockedError(
                f"Contrôle de sécurité Facebook détecté sur l'URL : {page.url}. "
                "Une action manuelle est nécessaire pour débloquer le compte."
            )

        # Détection de page introuvable ou contenu indisponible (404 Facebook)
        not_found_selectors = [
            'h2:has-text("Ce contenu n’est pas disponible")',
            'h2:has-text("Ce contenu n\'est pas disponible")',
            'h2:has-text("This content isn\'t available")',
            'span:has-text("Ce contenu n’est pas disponible")',
            'span:has-text("Ce contenu n\'est pas disponible")',
            'span:has-text("This content isn\'t available")',
        ]
        for sel in not_found_selectors:
            if await page.locator(sel).count() > 0:
                await save_debug_snapshot(page, "page_not_found")
                raise PageNotFoundError(
                    f"La page cible '{page.url}' est introuvable ou inaccessible sur Facebook "
                    "('Ce contenu n'est pas disponible pour le moment'). Vérifiez l'URL de la page."
                )

        # Détection d'un formulaire de connexion bloquant
        login_form = page.locator('input[name="email"], input[name="pass"]')
        has_login_fields = await login_form.count() > 0
        is_login_page = any(kw in current_url for kw in ["/login", "login.php", "/recover"])

        article_count = await page.locator(BLOCK_SELECTOR).count()
        if (is_login_page or has_login_fields) and article_count == 0:
            await save_debug_snapshot(page, "session_expired")
            raise SessionExpiredError(
                "Accès restreint par Facebook (formulaire de connexion affiché). "
                "Veuillez renouveler la session connectée avec : python -m scraping_service.facebook.auth"
            )

    async def _incremental_scroll_and_parse(
        self,
        page: Page,
        target_url: str,
        max_items: int,
        max_rounds: int = 25,
    ) -> list[FeedbackItem]:
        """Défilement incrémental qui extrait les posts à chaque étape avant le déchargement DOM."""
        items: list[FeedbackItem] = []
        seen_ids: set[str] = set()
        seen_texts: set[str] = set()
        stalls = 0
        prev_total = 0

        # 1. Extraction préliminaire depuis les payloads JSON SSR déjà présents dans la page
        try:
            initial_html = await page.content()
            ssr_items = extract_comet_ssr_items(initial_html, target_url, max_items)
            for it in ssr_items:
                if it.text not in seen_texts and it.source_id not in seen_ids:
                    seen_ids.add(it.source_id)
                    seen_texts.add(it.text)
                    items.append(it)
                    logger.debug(f"[{len(items)}/{max_items}] Post SSR initial extrait : {it.source_id}")
            if len(items) >= max_items:
                logger.info(f"Objectif de {max_items} publications atteint directement via SSR.")
                return items
        except Exception as ssr_exc:
            logger.debug(f"Erreur mineure extraction SSR préliminaire: {ssr_exc}")

        blocks_locator = page.locator(BLOCK_SELECTOR)

        for round_idx in range(max_rounds):
            count_in_dom = await blocks_locator.count()

            # Extraire les éléments visibles actuellement dans le DOM
            for idx in range(count_in_dom):
                block = blocks_locator.nth(idx)
                item = await extract_block_data(block, page, target_url)
                if not item:
                    continue
                if item.source_id not in seen_ids and item.text not in seen_texts:
                    seen_ids.add(item.source_id)
                    seen_texts.add(item.text)
                    items.append(item)
                    logger.debug(f"[{len(items)}/{max_items}] Post DOM extrait : {item.source_id}")

                if len(items) >= max_items:
                    logger.info(f"Objectif de {max_items} publications atteint.")
                    return items

            # Si des scripts supplémentaires sont injectés en streaming, les analyser
            if len(items) < max_items and round_idx % 2 == 0:
                try:
                    curr_html = await page.content()
                    stream_items = extract_comet_ssr_items(curr_html, target_url, max_items - len(items))
                    for sit in stream_items:
                        if sit.text not in seen_texts and sit.source_id not in seen_ids:
                            seen_ids.add(sit.source_id)
                            seen_texts.add(sit.text)
                            items.append(sit)
                            logger.debug(f"[{len(items)}/{max_items}] Post streaming extrait : {sit.source_id}")
                except Exception:
                    pass

            if len(items) >= max_items:
                logger.info(f"Objectif de {max_items} publications atteint.")
                return items

            # Gestion intelligente de fin de flux (stalls)
            if len(items) == prev_total:
                # Si nous n'avons encore rien trouvé, laisser au moins 6 tours de scroll pour dépasser l'en-tête
                if len(items) == 0:
                    if round_idx >= 6:
                        stalls += 1
                else:
                    stalls += 1
            else:
                stalls = 0
            prev_total = len(items)

            if stalls >= 3:
                logger.info(f"Fin du flux atteinte ou plus de nouvelles publications (stalls={stalls}).")
                break

            # Défilement garanti par evaluate window.scrollBy
            await page.evaluate("window.scrollBy(0, 1200)")
            await asyncio.sleep(1.8)
            await dismiss_banners(page, timeout_ms=400)

            # Si des squelettes de chargement sont visibles, patienter un instant de plus
            try:
                skeletons = await page.locator('div[data-visualcompletion="loading-state"]').count()
                if skeletons > 0:
                    await asyncio.sleep(1.0)
            except Exception:
                pass

        return items

    async def fetch(self, target: str, max_items: int = 20) -> list[FeedbackItem]:
        """Récupère les avis et publications d'une cible Facebook."""
        if not 1 <= max_items <= 200:
            raise ValueError("max_items doit être compris entre 1 et 200")

        target_url = normalize_facebook_url(target)
        state_path = settings.storage_state_path(self.source)

        logger.info(f"Début du scraping Facebook pour : {target_url} (max_items={max_items})")

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=settings.headless,
                args=CHROMIUM_ARGS,
            )
            try:
                context = await create_browser_context(browser, storage_state_path=state_path)
                page = await context.new_page()
                page.set_default_navigation_timeout(settings.nav_timeout_ms)

                # Tentative 1 : Navigation vers la cible
                logger.info(f"Navigation vers {target_url}...")
                response = await page.goto(target_url, wait_until="domcontentloaded")
                await asyncio.sleep(2)
                await dismiss_banners(page)
                await self._check_security_barriers(page)

                # Si aucun article n'apparaît et qu'on est sur standard, tester mbasic (ou inversement)
                initial_count = await page.locator(BLOCK_SELECTOR).count()
                if initial_count == 0 and "mbasic.facebook.com" not in page.url:
                    mbasic_candidate = to_mbasic_url(target_url)
                    logger.info(f"Aucun bloc détecté sur l'interface standard. Repli vers mbasic: {mbasic_candidate}")
                    try:
                        await page.goto(mbasic_candidate, wait_until="domcontentloaded")
                        await asyncio.sleep(2)
                        await dismiss_banners(page)
                        await self._check_security_barriers(page)
                    except Exception as fallback_exc:
                        logger.warning(f"Repli mbasic a échoué : {fallback_exc}")

                # Extraction incrémentale
                items = await self._incremental_scroll_and_parse(page, target_url, max_items)

                if not items:
                    logger.warning(f"Aucune publication extraite pour {target_url}.")
                    await save_debug_snapshot(page, "zero_items")

                logger.info(f"Scraping terminé avec succès : {len(items)} items extraits pour {target_url}")
                return items

            except (CheckpointBlockedError, SessionExpiredError, SessionMissingError, TargetValidationError):
                raise
            except Exception as exc:
                logger.error(f"Erreur inattendue pendant le scraping de {target_url}: {exc}", exc_info=True)
                try:
                    await save_debug_snapshot(page, "unexpected_error")
                except Exception:
                    pass
                raise ExtractionError(f"Échec de l'extraction sur {target_url}: {exc}") from exc
            finally:
                await browser.close()
