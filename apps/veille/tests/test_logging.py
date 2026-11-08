import logging

import httpx
import pytest

from scraping_service.core.logging import TokenMaskingFilter, apply_token_masking


@pytest.fixture
def masking_filter() -> TokenMaskingFilter:
    return TokenMaskingFilter()


def _record(msg, args=()):
    return logging.LogRecord("test", logging.INFO, "", 0, msg, args, None)


def test_url_query_parameters_redacted(masking_filter):
    record = _record("https://x/y?client_secret=ABC&code=XYZ&a=1")
    masking_filter.filter(record)

    sanitized = record.getMessage()
    assert "client_secret=[REDACTED]" in sanitized
    assert "code=[REDACTED]" in sanitized
    assert "a=1" in sanitized
    assert "ABC" not in sanitized
    assert "XYZ" not in sanitized


@pytest.mark.parametrize(
    "key",
    ["access_token", "client_secret", "code", "fb_exchange_token", "input_token", "app_secret", "secret", "authorization"],
)
def test_every_sensitive_query_key_is_redacted(masking_filter, key):
    record = _record(f"GET https://graph.example/x?{key}=VALEUR-SECRETE&page=1")
    masking_filter.filter(record)

    assert "VALEUR-SECRETE" not in record.getMessage()
    assert f"{key}=[REDACTED]" in record.getMessage()
    assert "page=1" in record.getMessage()


def test_keys_merely_containing_code_are_not_masked(masking_filter):
    record = _record("Meta a répondu error_code=190 status_code=400")
    masking_filter.filter(record)

    assert record.getMessage() == "Meta a répondu error_code=190 status_code=400"


def test_httpx_url_object_redacted(masking_filter):
    url = httpx.URL("https://graph.facebook.com/v19.0/me?access_token=EAAB123")
    record = _record("Requesting: %s", (url,))
    masking_filter.filter(record)

    sanitized = record.getMessage()
    assert "access_token=[REDACTED]" in sanitized
    assert "EAAB123" not in sanitized


def test_bearer_token_redacted(masking_filter):
    record = _record("Authorization header: Bearer abcdef")
    masking_filter.filter(record)

    assert "Bearer [REDACTED]" in record.getMessage()
    assert "abcdef" not in record.getMessage()


def test_meta_token_pattern_redacted(masking_filter):
    record = _record("jeton EAAGm0PX4ZCpsBAKZB reçu")
    masking_filter.filter(record)

    assert "EAAGm0PX4ZCpsBAKZB" not in record.getMessage()


def test_integer_format_specifier_preserved(masking_filter):
    record = _record("Processed %d items", (42,))
    masking_filter.filter(record)

    # Si 42 avait été converti en texte, le formatage %d lèverait un TypeError.
    assert record.getMessage() == "Processed 42 items"


def test_message_without_secret_unchanged(masking_filter):
    msg = "Synchronisation de la page terminée avec succès pour Page ABC"
    record = _record(msg)
    masking_filter.filter(record)

    assert record.getMessage() == msg


def test_dict_list_and_tuple_arguments_are_sanitized_recursively(masking_filter):
    payload = {
        "access_token": "SECRET-1",
        "Authorization": "Bearer SECRET-2",
        "page_id": "12345",
        "nested": {"client_secret": "SECRET-3", "urls": ["https://x/y?code=SECRET-4", ({"input_token": "SECRET-5"},)]},
    }
    record = _record("params=%s", (payload,))
    masking_filter.filter(record)

    rendered = record.getMessage()
    for secret in ("SECRET-1", "SECRET-2", "SECRET-3", "SECRET-4", "SECRET-5"):
        assert secret not in rendered
    assert "12345" in rendered


def test_dict_message_itself_is_sanitized(masking_filter):
    record = _record({"app_secret": "SECRET-6", "ok": 1})
    masking_filter.filter(record)

    assert "SECRET-6" not in record.getMessage()
    assert "'ok': 1" in record.getMessage()


def test_mapping_style_arguments_are_sanitized(masking_filter):
    record = logging.LogRecord("test", logging.INFO, "", 0, "%(token)s %(secret)s", ({"token": "EAAB999", "secret": "S-7"},), None)
    masking_filter.filter(record)

    assert "EAAB999" not in record.getMessage()
    assert "S-7" not in record.getMessage()


def test_logger_integration_masks_secrets_and_handles_dict():
    test_logger = logging.getLogger("test_masking_integration")
    test_logger.handlers.clear()
    test_logger.setLevel(logging.INFO)
    test_logger.propagate = False

    class CapturingHandler(logging.Handler):
        def __init__(self):
            super().__init__()
            self.records = []

        def emit(self, record):
            self.records.append(self.format(record))

    handler = CapturingHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    test_logger.addHandler(handler)
    apply_token_masking(test_logger)

    test_logger.info("Connecting with params: %s", {"access_token": "secret_token_123", "page_id": "12345"})

    assert len(handler.records) == 1
    assert "'access_token': '[REDACTED]'" in handler.records[0]
    assert "secret_token_123" not in handler.records[0]
    assert "12345" in handler.records[0]
