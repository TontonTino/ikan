"""Tests unitaires pour le moteur de parsing de dates Facebook."""

from datetime import datetime, timezone

import pytest

from scraping_service.facebook.dates import (
    parse_facebook_date,
    parse_timestamp_attribute,
)

FIXED_NOW = datetime(2026, 9, 21, 14, 0, 0, tzinfo=timezone.utc)


def test_parse_timestamp_attribute():
    # 1726927200 = 2024-09-21 14:00:00 UTC
    dt = parse_timestamp_attribute("1726927200")
    assert dt is not None
    assert dt.year == 2024
    assert dt.month == 9
    assert dt.day == 21

    assert parse_timestamp_attribute(None) is None
    assert parse_timestamp_attribute("invalid") is None
    assert parse_timestamp_attribute("0") is None


def test_parse_relative_instant():
    assert parse_facebook_date("à l'instant", now=FIXED_NOW) == FIXED_NOW
    assert parse_facebook_date("just now", now=FIXED_NOW) == FIXED_NOW
    assert parse_facebook_date("maintenant", now=FIXED_NOW) == FIXED_NOW


def test_parse_relative_french():
    # Minutes
    dt_5m = parse_facebook_date("5 min", now=FIXED_NOW)
    assert dt_5m is not None
    assert dt_5m.minute == 55
    assert dt_5m.hour == 13

    dt_il_y_a_m = parse_facebook_date("il y a 10 minutes", now=FIXED_NOW)
    assert dt_il_y_a_m is not None
    assert dt_il_y_a_m.minute == 50

    # Heures
    dt_2h = parse_facebook_date("2 h", now=FIXED_NOW)
    assert dt_2h is not None
    assert dt_2h.hour == 12

    dt_il_y_a_h = parse_facebook_date("il y a 3 heures", now=FIXED_NOW)
    assert dt_il_y_a_h is not None
    assert dt_il_y_a_h.hour == 11

    # Jours
    dt_3j = parse_facebook_date("3 j", now=FIXED_NOW)
    assert dt_3j is not None
    assert dt_3j.day == 18

    # Semaines
    dt_1sem = parse_facebook_date("1 sem", now=FIXED_NOW)
    assert dt_1sem is not None
    assert dt_1sem.day == 14


def test_parse_relative_english():
    dt_2h = parse_facebook_date("2 hrs", now=FIXED_NOW)
    assert dt_2h is not None
    assert dt_2h.hour == 12

    dt_3d = parse_facebook_date("3 days ago", now=FIXED_NOW)
    assert dt_3d is not None
    assert dt_3d.day == 18


def test_parse_hier_and_today():
    dt_hier = parse_facebook_date("hier à 10:30", now=FIXED_NOW)
    assert dt_hier is not None
    assert dt_hier.day == 20
    assert dt_hier.hour == 10
    assert dt_hier.minute == 30

    dt_today = parse_facebook_date("aujourd'hui à 09:15", now=FIXED_NOW)
    assert dt_today is not None
    assert dt_today.day == 21
    assert dt_today.hour == 9
    assert dt_today.minute == 15


def test_parse_absolute_dates():
    # Français
    dt_abs_fr = parse_facebook_date("15 septembre 2025 à 18:45", now=FIXED_NOW)
    assert dt_abs_fr is not None
    assert dt_abs_fr.year == 2025
    assert dt_abs_fr.month == 9
    assert dt_abs_fr.day == 15
    assert dt_abs_fr.hour == 18
    assert dt_abs_fr.minute == 45

    # Anglais
    dt_abs_en = parse_facebook_date("September 15, 2025 at 6:45 pm", now=FIXED_NOW)
    assert dt_abs_en is not None
    assert dt_abs_en.year == 2025
    assert dt_abs_en.month == 9
    assert dt_abs_en.day == 15
    assert dt_abs_en.hour == 18
    assert dt_abs_en.minute == 45


def test_parse_invalid_date():
    assert parse_facebook_date("") is None
    assert parse_facebook_date(None) is None
    assert parse_facebook_date("texte quelconque sans date") is None
