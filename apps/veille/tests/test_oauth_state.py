import pytest

from scraping_service.core.oauth_state import consume_oauth_state, create_oauth_state


def test_signed_state_validates_once():
    used = set()
    state = create_oauth_state("client-a", "https://client.example/return", "state-secret", now=100, nonce="nonce-a")

    payload = consume_oauth_state(state, "state-secret", used, now=101)

    assert payload["client_id"] == "client-a"
    assert payload["return_to"] == "https://client.example/return"
    with pytest.raises(ValueError):
        consume_oauth_state(state, "state-secret", used, now=101)


def test_signed_state_rejects_expired_or_tampered_values():
    expired = create_oauth_state("client-a", "https://client.example/return", "state-secret", now=100)
    valid = create_oauth_state("client-a", "https://client.example/return", "state-secret", now=100)

    with pytest.raises(ValueError):
        consume_oauth_state(expired, "state-secret", set(), now=701)
    with pytest.raises(ValueError):
        consume_oauth_state(valid + "tampered", "state-secret", set(), now=101)