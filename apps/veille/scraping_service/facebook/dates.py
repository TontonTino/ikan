"""Moteur robuste de parsing des dates Facebook (formats relatifs, absolus et machine)."""

from datetime import datetime, time, timedelta, timezone
import re
from typing import Any

MONTHS_FR = {
    "janvier": 1, "janv": 1, "janv.": 1,
    "février": 2, "fevrier": 2, "févr": 2, "fevr": 2, "févr.": 2,
    "mars": 3,
    "avril": 4, "avr": 4, "avr.": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7, "juil": 7, "juil.": 7,
    "août": 8, "aout": 8,
    "septembre": 9, "sept": 9, "sept.": 9,
    "octobre": 10, "oct": 10, "oct.": 10,
    "novembre": 11, "nov": 11, "nov.": 11,
    "décembre": 12, "decembre": 12, "déc": 12, "dec": 12, "déc.": 12,
}

MONTHS_EN = {
    "january": 1, "jan": 1, "jan.": 1,
    "february": 2, "feb": 2, "feb.": 2,
    "march": 3, "mar": 3, "mar.": 3,
    "april": 4, "apr": 4, "apr.": 4,
    "may": 5,
    "june": 6, "jun": 6, "jun.": 6,
    "july": 7, "jul": 7, "jul.": 7,
    "august": 8, "aug": 8, "aug.": 8,
    "september": 9, "sep": 9, "sep.": 9, "sept": 9,
    "october": 10, "oct": 10, "oct.": 10,
    "november": 11, "nov": 11, "nov.": 11,
    "december": 12, "dec": 12, "dec.": 12,
}

ALL_MONTHS = {**MONTHS_FR, **MONTHS_EN}


def parse_timestamp_attribute(val: Any) -> datetime | None:
    """Parse un timestamp Unix numérique issu de data-utime ou semblable."""
    if not val:
        return None
    try:
        ts = int(val)
        if ts > 0:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        pass
    return None


def parse_facebook_date(date_str: str | None, now: datetime | None = None) -> datetime | None:
    """Parse une chaîne de date Facebook (FR ou EN, relative ou absolue) en UTC datetime."""
    if not date_str:
        return None

    now = now or datetime.now(timezone.utc)
    text = date_str.strip().lower()

    # Nettoyage des préfixes et caractères superflus
    text = re.sub(r"^[·•\s-]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return None

    # 1. Format instantané
    if text in {"à l'instant", "a l'instant", "just now", "maintenant", "now"}:
        return now

    # 2. Formats relatifs simples : "2 j", "3 h", "15 min", "il y a 2 h", "3 days ago"
    # min / mn / minutes / m
    m_min = re.search(r"(?:il y a\s+)?(\d+)\s*(?:min|mn|minute|minutes|m)\b", text)
    if m_min:
        return now - timedelta(minutes=int(m_min.group(1)))

    # heures / h / hrs / hr
    m_h = re.search(r"(?:il y a\s+)?(\d+)\s*(?:h|heure|heures|hr|hrs|hours)\b", text)
    if m_h:
        return now - timedelta(hours=int(m_h.group(1)))

    # jours / j / d / days
    m_d = re.search(r"(?:il y a\s+)?(\d+)\s*(?:j|jour|jours|d|day|days)\b", text)
    if m_d:
        return now - timedelta(days=int(m_d.group(1)))

    # semaines / sem / w / weeks
    m_w = re.search(r"(?:il y a\s+)?(\d+)\s*(?:sem|semaine|semaines|w|week|weeks)\.?", text)
    if m_w:
        return now - timedelta(weeks=int(m_w.group(1)))

    # mois / mo / months (approximation 30 jours)
    m_mo = re.search(r"(?:il y a\s+)?(\d+)\s*(?:mois|month|months|mo)\b", text)
    if m_mo:
        return now - timedelta(days=30 * int(m_mo.group(1)))

    # ans / an / y / years (approximation 365 jours)
    m_y = re.search(r"(?:il y a\s+)?(\d+)\s*(?:an|ans|year|years|y)\b", text)
    if m_y:
        return now - timedelta(days=365 * int(m_y.group(1)))

    # 3. "hier à HH:MM" ou "yesterday at HH:MM"
    m_hier = re.search(r"(?:hier|yesterday)(?:\s+(?:à|a|at)\s+(\d{1,2})[:h](\d{2}))?", text)
    if m_hier:
        target_day = now - timedelta(days=1)
        h = int(m_hier.group(1)) if m_hier.group(1) else 12
        m = int(m_hier.group(2)) if m_hier.group(2) else 0
        return target_day.replace(hour=h, minute=m, second=0, microsecond=0)

    # 4. "aujourd'hui à HH:MM" ou "today at HH:MM"
    m_today = re.search(r"(?:aujourd'hui|today)(?:\s+(?:à|a|at)\s+(\d{1,2})[:h](\d{2}))?", text)
    if m_today:
        h = int(m_today.group(1)) if m_today.group(1) else now.hour
        m = int(m_today.group(2)) if m_today.group(2) else now.minute
        return now.replace(hour=h, minute=m, second=0, microsecond=0)

    # 5. Format absolu FR : "15 septembre [2024] [à 14:30]" ou "15 sept."
    pattern_fr = (
        r"(\d{1,2})\s+([a-zéûà.]+)"
        r"(?:\s+(\d{4}))?"
        r"(?:(?:\s+à|\s+a|,)\s+(\d{1,2})[:h](\d{2}))?"
    )
    m_abs_fr = re.search(pattern_fr, text)
    if m_abs_fr:
        day = int(m_abs_fr.group(1))
        month_str = m_abs_fr.group(2).rstrip(".")
        year = int(m_abs_fr.group(3)) if m_abs_fr.group(3) else now.year
        h = int(m_abs_fr.group(4)) if m_abs_fr.group(4) else 12
        m = int(m_abs_fr.group(5)) if m_abs_fr.group(5) else 0

        month = ALL_MONTHS.get(month_str) or ALL_MONTHS.get(month_str + ".")
        if month:
            try:
                # Si l'année n'était pas précisée et que la date est dans le futur, c'était l'an passé
                res = datetime(year, month, day, h, m, tzinfo=timezone.utc)
                if not m_abs_fr.group(3) and res > now:
                    res = datetime(year - 1, month, day, h, m, tzinfo=timezone.utc)
                return res
            except ValueError:
                pass

    # 6. Format absolu EN : "September 15[, 2024] [at 2:30 PM]"
    pattern_en = (
        r"([a-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?"
        r"(?:\s+(?:at\s+)?(\d{1,2}):(\d{2})(?:\s*(am|pm))?)?"
    )
    m_abs_en = re.search(pattern_en, text)
    if m_abs_en:
        month_str = m_abs_en.group(1).rstrip(".")
        day = int(m_abs_en.group(2))
        year = int(m_abs_en.group(3)) if m_abs_en.group(3) else now.year
        h = int(m_abs_en.group(4)) if m_abs_en.group(4) else 12
        m = int(m_abs_en.group(5)) if m_abs_en.group(5) else 0
        ampm = m_abs_en.group(6)
        if ampm == "pm" and h < 12:
            h += 12
        elif ampm == "am" and h == 12:
            h = 0

        month = ALL_MONTHS.get(month_str) or ALL_MONTHS.get(month_str + ".")
        if month:
            try:
                res = datetime(year, month, day, h, m, tzinfo=timezone.utc)
                if not m_abs_en.group(3) and res > now:
                    res = datetime(year - 1, month, day, h, m, tzinfo=timezone.utc)
                return res
            except ValueError:
                pass

    return None
