"""Validation syntaxique internationale des numéros de téléphone."""
import pytest

from app.utils.phone import normaliser_telephone


@pytest.mark.parametrize("saisie, attendu", [
    ("+226 70 12 34 56", "22670123456"),
    ("0022670123456", "22670123456"),
    ("+33 6 12 34 56 78", "33612345678"),
    ("+1 (202) 555-0123", "12025550123"),
    ("+358 40 1234567", "358401234567"),
    ("+12345678", "12345678"),
    ("+123456789012345", "123456789012345"),
])
def test_international_formats_valides(saisie, attendu):
    assert normaliser_telephone(saisie) == attendu


@pytest.mark.parametrize("saisie", [
    "70 12 34 56", "70123456", "22670123456", "123", "+1234567",
    "+1234567890123456", "+0123456789", "+33 6 12 34 5a", "+١٢٣٤٥٦٧٨٩",
    "70123456; DROP", "+", "00", "", "   ", None,
])
def test_saisies_invalides(saisie):
    assert normaliser_telephone(saisie) is None
