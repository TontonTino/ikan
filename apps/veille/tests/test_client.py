import asyncio

import httpx
import pytest

from scraping_service.config import settings
from scraping_service.core.exceptions import (
    FacebookAPIError,
    PageNotFoundError,
    PermissionDeniedError,
    RateLimitError,
    TokenExpiredError,
)
from scraping_service.facebook.client import FacebookGraphClient


def run(coroutine):
    return asyncio.run(coroutine)


def test_graph_error_mapping_uses_codes_not_error_type():
    client = FacebookGraphClient(access_token="test-token")
    cases = [
        (190, TokenExpiredError),
        (102, TokenExpiredError),
        (200, PermissionDeniedError),
        (250, PermissionDeniedError),
        (10, PermissionDeniedError),
        (803, PageNotFoundError),
        (4, RateLimitError),
        (17, RateLimitError),
        (32, RateLimitError),
        (613, RateLimitError),
    ]
    try:
        for code, expected in cases:
            with pytest.raises(expected):
                client._handle_api_error({"code": code, "type": "OAuthException", "message": "redacted"})
    finally:
        run(client.aclose())


def test_graph_post_pagination_strips_token_from_next_url():
    calls = []

    async def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(
                200,
                json={
                    "data": [{"id": "post-1"}],
                    "paging": {"next": "https://graph.facebook.com/v25.0/page/posts?after=next&access_token=leak"},
                },
            )
        return httpx.Response(200, json={"data": [{"id": "post-2"}]})

    client = FacebookGraphClient(
        access_token="test-token",
        api_version="v25.0",
        transport=httpx.MockTransport(handler),
    )
    try:
        posts = run(client.fetch_page_posts("page", limit=2))
    finally:
        run(client.aclose())

    assert [post["id"] for post in posts] == ["post-1", "post-2"]
    assert "access_token" not in calls[1].url.query.decode()
    assert calls[1].headers["Authorization"] == "Bearer test-token"


def test_graph_retries_429_then_succeeds():
    calls = 0
    waits = []

    async def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": {"code": 4}})
        return httpx.Response(200, json={"data": []})

    async def fake_sleep(delay):
        waits.append(delay)

    client = FacebookGraphClient(
        access_token="test-token",
        transport=httpx.MockTransport(handler),
        sleep=fake_sleep,
    )
    try:
        result = run(client._request_json("https://graph.facebook.com/test"))
    finally:
        run(client.aclose())

    assert result == {"data": []}
    assert calls == 2
    assert waits == [0.0]


def test_non_json_server_error_becomes_safe_facebook_error():
    async def handler(request):
        return httpx.Response(502, text="upstream failure with no details")

    client = FacebookGraphClient(
        access_token="test-token",
        transport=httpx.MockTransport(handler),
        sleep=lambda _: asyncio.sleep(0),
    )
    try:
        with pytest.raises(FacebookAPIError, match="temporairement indisponible"):
            run(client._request_json("https://graph.facebook.com/test"))
    finally:
        run(client.aclose())


def test_explicit_empty_token_does_not_fall_back_to_configured_token(monkeypatch):
    monkeypatch.setattr(settings, "fb_page_access_token", "configured-test-token")
    seen_headers = []

    async def handler(request):
        seen_headers.append(request.headers)
        return httpx.Response(200, json={"access_token": "temporary-test-token"})

    client = FacebookGraphClient(access_token="", transport=httpx.MockTransport(handler))
    try:
        run(client._request_json("https://graph.facebook.com/oauth/access_token"))
    finally:
        run(client.aclose())

    assert "Authorization" not in seen_headers[0]