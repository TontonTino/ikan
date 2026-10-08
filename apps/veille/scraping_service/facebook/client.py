"""Client HTTP asynchrone et injectable pour l'API Meta Facebook Graph."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from scraping_service.config import settings
from scraping_service.core.exceptions import (
    ConfigurationError,
    FacebookAPIError,
    PageNotFoundError,
    PermissionDeniedError,
    RateLimitError,
    TokenExpiredError,
    TokenMissingError,
)


class FacebookGraphClient:
    """Client officiel Meta Graph API ; le transport peut être remplacé en test."""

    def __init__(
        self,
        access_token: str | None = None,
        api_version: str | None = None,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
        max_retries: int = 3,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ):
        self.access_token = settings.fb_page_access_token if access_token is None else access_token
        self.api_version = api_version or settings.fb_api_version
        self.base_url = f"https://graph.facebook.com/{self.api_version}"
        self.max_retries = max(1, max_retries)
        self._sleep = sleep or asyncio.sleep
        self._http = httpx.AsyncClient(timeout=timeout, transport=transport)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "FacebookGraphClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    def _ensure_token(self, token: str | None = None) -> str:
        effective_token = token or self.access_token
        if not effective_token:
            raise TokenMissingError()
        return effective_token

    @staticmethod
    def _handle_api_error(error: dict[str, Any]) -> None:
        code = error.get("code")
        subcode = error.get("error_subcode")
        message = str(error.get("message", "")).lower()
        details = {"meta_code": code} if code is not None else {}
        if subcode is not None:
            details["error_subcode"] = subcode

        # Classement des erreurs de jeton et sous-codes (Étape 6)
        if code in {190, 102}:
            if subcode in {463, 467}:
                details["reauth_reason"] = "Session ou jeton expiré"
                details["status"] = "reauth_required"
                raise TokenExpiredError("Le jeton Meta est expiré.", details=details)
            elif subcode == 460:
                details["reauth_reason"] = "Mot de passe changé ou session fermée"
                details["status"] = "reauth_required"
                raise TokenExpiredError("Mot de passe changé ou session fermée.", details=details)
            elif subcode == 492:
                details["reauth_reason"] = "L'utilisateur n'a plus de rôle sur la Page"
                details["status"] = "reauth_required"
                raise TokenExpiredError("L'utilisateur n'a plus de rôle sur la Page.", details=details)
            elif subcode == 458:
                details["reauth_reason"] = "Application retirée par l'utilisateur"
                details["status"] = "revoked"
                raise PermissionDeniedError("Application retirée par l'utilisateur.", details=details)
            elif subcode is not None:
                details["reauth_reason"] = f"Erreur d'authentification ({subcode})"
                details["status"] = "reauth_required"
                raise TokenExpiredError(f"Erreur d'authentification ({subcode}).", details=details)
            else:
                details["reauth_reason"] = "Le jeton Meta est expiré ou invalide."
                details["status"] = "reauth_required"
                raise TokenExpiredError("Le jeton Meta est expiré ou invalide.", details=details)

        if subcode in {463, 467}:
            details["reauth_reason"] = "Session ou jeton expiré"
            details["status"] = "reauth_required"
            raise TokenExpiredError("Le jeton Meta est expiré ou invalide.", details=details)
        if subcode == 458:
            details["reauth_reason"] = "Application retirée par l'utilisateur"
            details["status"] = "revoked"
            raise PermissionDeniedError("Application retirée par l'utilisateur.", details=details)

        if code in {10, 200, 298} or (isinstance(code, int) and 200 <= code <= 299):
            raise PermissionDeniedError("Les permissions Meta accordées sont insuffisantes.", details=details)
        if code in {4, 17, 32, 613} or (isinstance(code, int) and 80001 <= code <= 80014):
            raise RateLimitError("La limite d'appels Meta a été atteinte.", details=details)
        if code == 803 or (code == 100 and ("not found" in message or "does not exist" in message)):
            raise PageNotFoundError("La Page Meta demandée est introuvable.", details=details)
        raise FacebookAPIError("Meta Graph a refusé la requête.", error_code="META_API_ERROR", details=details)

    @staticmethod
    def _retry_after(value: str | None) -> float | None:
        if value is None:
            return None
        try:
            return max(0.0, min(float(value), 60.0))
        except ValueError:
            try:
                return max(0.0, min((parsedate_to_datetime(value) - datetime.now().astimezone()).total_seconds(), 60.0))
            except (TypeError, ValueError, OverflowError):
                return None

    async def _request_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        token: str | None = None,
        method: str = "GET",
        include_auth_header: bool = True,
    ) -> dict[str, Any]:
        headers = {}
        if include_auth_header and (token or self.access_token):
            headers["Authorization"] = f"Bearer {self._ensure_token(token)}"
        for attempt in range(self.max_retries):
            try:
                response = await self._http.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    headers=headers,
                )
            except httpx.RequestError as exc:
                if attempt + 1 == self.max_retries:
                    raise FacebookAPIError("Impossible de joindre l'API Meta Graph.", error_code="META_NETWORK_ERROR") from exc
                await self._sleep(min(2**attempt, 10))
                continue

            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 < self.max_retries:
                    delay = self._retry_after(response.headers.get("Retry-After"))
                    await self._sleep(delay if delay is not None else min(2**attempt, 10))
                    continue
                if response.status_code == 429:
                    raise RateLimitError("La limite d'appels Meta a été atteinte.")
                raise FacebookAPIError("L'API Meta Graph est temporairement indisponible.", error_code="META_HTTP_ERROR")

            if response.status_code >= 400:
                try:
                    error_payload = response.json()
                except ValueError as exc:
                    raise FacebookAPIError("Meta Graph a renvoyé une réponse HTTP invalide.", error_code="META_HTTP_ERROR") from exc
                if isinstance(error_payload, dict) and isinstance(error_payload.get("error"), dict):
                    self._handle_api_error(error_payload["error"])
                raise FacebookAPIError("Meta Graph a refusé la requête.", error_code="META_HTTP_ERROR")

            try:
                payload = response.json()
            except ValueError as exc:
                raise FacebookAPIError("Meta Graph a renvoyé une réponse non JSON.", error_code="META_INVALID_RESPONSE") from exc
            if not isinstance(payload, dict):
                raise FacebookAPIError("Meta Graph a renvoyé une réponse invalide.", error_code="META_INVALID_RESPONSE")
            if isinstance(payload.get("error"), dict):
                try:
                    self._handle_api_error(payload["error"])
                except RateLimitError:
                    if attempt + 1 == self.max_retries:
                        raise
                    delay = self._retry_after(response.headers.get("Retry-After"))
                    await self._sleep(delay if delay is not None else min(2**attempt, 10))
                    continue
            return payload
        raise FacebookAPIError("La requête Meta Graph a échoué.", error_code="META_HTTP_ERROR")

    async def _paginate(
        self,
        url: str,
        *,
        token: str,
        params: dict[str, Any] | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        next_url: str | None = url
        next_params = params
        while next_url and (limit is None or len(items) < limit):
            response = await self._request_json(next_url, params=next_params, token=token)
            batch = response.get("data", [])
            if isinstance(batch, list):
                items.extend(item for item in batch if isinstance(item, dict))
            next_url = response.get("paging", {}).get("next")
            if next_url:
                parsed = urlsplit(next_url)
                safe_query = urlencode(
                    [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.lower() != "access_token"]
                )
                next_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, safe_query, parsed.fragment))
            next_params = None
        return items[:limit] if limit is not None else items

    async def get_page_info(self, page_id: str) -> dict[str, Any]:
        """Récupère les métadonnées d'une Page Facebook."""
        return await self._request_json(
            f"{self.base_url}/{page_id}",
            params={"fields": "id,name,category,link,followers_count"},
        )

    async def fetch_page_posts(
        self,
        page_id: str,
        limit: int = 25,
        since: datetime | None = None,
    ) -> list[dict[str, Any]]:
        """Récupère les publications récentes, en suivant les curseurs Graph."""
        params: dict[str, Any] = {
            "fields": "id,message,created_time,permalink_url,shares,reactions.summary(true),comments.summary(true)",
            "limit": min(limit, 100),
        }
        if since is not None:
            params["since"] = int(since.timestamp())
        return await self._paginate(
            f"{self.base_url}/{page_id}/posts",
            token=self._ensure_token(),
            params=params,
            limit=limit,
        )

    async def fetch_post_comments(self, post_id: str, max_comments: int = 100) -> list[dict[str, Any]]:
        """Récupère les commentaires d'une publication avec pagination."""
        return await self._paginate(
            f"{self.base_url}/{post_id}/comments",
            token=self._ensure_token(),
            params={
                "fields": "id,from,message,created_time,like_count,user_likes,permalink_url",
                "limit": min(50, max_comments),
            },
            limit=max_comments,
        )

    async def fetch_managed_pages(self, user_token: str) -> list[dict[str, Any]]:
        """Liste toutes les Pages gérées par l'utilisateur OAuth avec leurs jetons."""
        return await self._paginate(
            f"{self.base_url}/me/accounts",
            token=user_token,
            params={"fields": "id,name,category,tasks,access_token", "limit": 100},
        )

    async def exchange_oauth_code(self, code: str) -> dict[str, Any]:
        """Échange le code de redirection OAuth contre un jeton utilisateur."""
        if not settings.fb_app_id or not settings.fb_app_secret:
            raise ConfigurationError(
                "VEILLE_FB_APP_ID et VEILLE_FB_APP_SECRET sont requis dans le fichier .env pour échanger les codes OAuth."
            )
        return await self._request_json(
            f"{self.base_url}/oauth/access_token",
            params={
                "client_id": settings.fb_app_id,
                "client_secret": settings.fb_app_secret,
                "redirect_uri": settings.fb_redirect_uri,
                "code": code,
            },
        )

    async def exchange_for_long_lived_token(self, short_lived_token: str) -> dict[str, Any]:
        """Échange le jeton utilisateur court contre un jeton longue durée."""
        if not settings.fb_app_id or not settings.fb_app_secret:
            raise ConfigurationError(
                "VEILLE_FB_APP_ID et VEILLE_FB_APP_SECRET sont requis dans le fichier .env pour l'échange de jetons longue durée."
            )
        return await self._request_json(
            f"{self.base_url}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.fb_app_id,
                "client_secret": settings.fb_app_secret,
                "fb_exchange_token": short_lived_token,
            },
        )

    async def debug_token(self, input_token: str) -> dict[str, Any]:
        """Inspecte un jeton via GET /debug_token avec l'App Access Token."""
        if not settings.fb_app_id or not settings.fb_app_secret:
            raise ConfigurationError(
                "VEILLE_FB_APP_ID et VEILLE_FB_APP_SECRET sont requis dans le fichier .env pour valider les jetons."
            )
        app_token = f"{settings.fb_app_id}|{settings.fb_app_secret}"
        response = await self._request_json(
            f"{self.base_url}/debug_token",
            params={"input_token": input_token, "access_token": app_token},
            include_auth_header=False,
        )
        data = response.get("data", {})
        return data if isinstance(data, dict) else {}


REQUIRED_PAGE_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_read_user_content"]
