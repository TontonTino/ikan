"""Normalisation des numéros de téléphone (Burkina Faso : 226 + 8 chiffres)."""
import pytest

from app.utils.phone import normaliser_telephone


@pytest.mark.parametrize("saisie", [
    "70 12 34 56",
    "70123456",
    "+226 70123456",
    "+226 70 12 34 56",
    "0022670123456",
    "00226 70 12 34 56",
    "22670123456",  # indicatif collé sans « + »
])
def test_formats_valides(saisie):
    assert normaliser_telephone(saisie) == "22670123456"


def test_separateurs_tolerés():
    assert normaliser_telephone(" +226-70.12.34.56 ") == "22670123456"
    assert normaliser_telephone("(70) 12 34 56") == "22670123456"


@pytest.mark.parametrize("saisie", [
    "7012345",            # trop court (7)
    "701234567",          # trop long (9)
    "+226 7012345",       # indicatif + 7 chiffres
    "+226 701234567",     # indicatif + 9 chiffres
    "+33 6 12 34 56 78",  # autre pays : refusé pour l'instant
    "abcdefgh",
    "70 12 34 5a",
    "70123456; DROP",
    "+",
    "00",
    "",
    "   ",
    None,
])
def test_invalides(saisie):
    assert normaliser_telephone(saisie) is None


def test_chiffres_non_ascii_refuses():
    assert normaliser_telephone("٧٠١٢٣٤٥٦") is None  # chiffres arabo-indiens
