"""Renseigne les coordonnées GPS manquantes des agences (carte du réseau, onglet Statistiques > Agences).

Pourquoi : la carte lit latitude/longitude sur chaque agence. Une base recréée sans ces deux champs
affiche « Aucune agence n'a de coordonnées géographiques ».

Ce que fait le script, dans l'organisation « Orange Burkina Faso » uniquement :
  - il ne touche QUE les agences dont latitude OU longitude est vide (jamais une position déjà saisie) ;
  - il applique la position connue de l'agence (table AGENCES ci-dessous, par nom exact) ;
  - à défaut, il place l'agence au centre de sa ville (table VILLES), signalé « approximatif » ;
  - une agence ni connue ni dans une ville connue est listée, et laissée telle quelle.

Par défaut : aperçu sans écriture. Avec --apply : écriture dans une seule transaction.

Usage (depuis apps/api) :
    python scripts/renseigner_coordonnees_agences.py           # aperçu
    python scripts/renseigner_coordonnees_agences.py --apply   # écriture
"""
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ORG_NAME = "Orange Burkina Faso"

# Positions de démonstration, à l'échelle du quartier (à affiner dans Gestion des agences si besoin).
AGENCES: dict[str, tuple[float, float]] = {
    "Agence Orange Siège (Koulouba)": (12.3714, -1.5197),
    "Agence Orange Ouaga 2000": (12.333, -1.495),
    "Agence Premium Centre Commercial Ouaga 2000": (12.329, -1.487),
    "Agence Orange Tanghin": (12.395, -1.51),
    "Agence Orange Saaba": (12.374, -1.424),
    "Agence Premium Super U Zad": (12.348, -1.479),
    "Agence Orange Pissy": (12.333, -1.565),
    "Agence Orange Bobo-Dioulasso": (11.1771, -4.2979),
    "Agence Orange Koupéla": (12.179, -0.351),
    "Agence Ouahigouya": (13.5828, -2.4216),
    "Orange Digital Center (Cissin)": (12.333, -1.535),
}

VILLES: dict[str, tuple[float, float]] = {
    "Ouagadougou": (12.3714, -1.5197),
    "Bobo-Dioulasso": (11.1771, -4.2979),
    "Koupéla": (12.179, -0.351),
    "Ouahigouya": (13.5828, -2.4216),
    "Saaba": (12.374, -1.424),
    "Koudougou": (12.2526, -2.3627),
    "Banfora": (10.6333, -4.7667),
    "Kaya": (13.0917, -1.0844),
    "Tenkodogo": (11.78, -0.3697),
    "Fada N'Gourma": (12.0616, 0.3585),
}


def _cle(texte: str | None) -> str:
    """Comparaison tolérante : sans accents, sans casse, espaces et apostrophes normalisés."""
    sans_accents = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode()
    return " ".join(sans_accents.replace("’", "'").lower().split())


_AGENCES = {_cle(nom): position for nom, position in AGENCES.items()}
_VILLES = {_cle(nom): position for nom, position in VILLES.items()}


def coordonnees_pour(nom: str | None, ville: str | None) -> tuple[float, float, bool] | None:
    """(latitude, longitude, approximatif) pour une agence, ou None si rien de connu."""
    if (position := _AGENCES.get(_cle(nom))) is not None:
        return position[0], position[1], False
    if (position := _VILLES.get(_cle(ville))) is not None:
        return position[0], position[1], True
    return None


def main() -> int:
    from app.db.session import SessionLocal
    from app.models.agence import Agence
    from app.models.organisation import Organisation

    appliquer = "--apply" in sys.argv[1:]
    db = SessionLocal()
    try:
        org = db.query(Organisation).filter(Organisation.nom == ORG_NAME).first()
        if org is None:
            print(f"Organisation « {ORG_NAME} » introuvable : rien à faire.")
            return 1
        agences = db.query(Agence).filter(Agence.organisation_id == org.id).order_by(Agence.nom).all()
        a_remplir = [a for a in agences if a.latitude is None or a.longitude is None]
        print(f"{len(agences)} agence(s), dont {len(a_remplir)} sans coordonnées.")
        modifiees = 0
        for agence in a_remplir:
            trouve = coordonnees_pour(agence.nom, agence.ville)
            if trouve is None:
                print(f"  [À SAISIR À LA MAIN] {agence.nom} ({agence.ville or 'ville inconnue'})")
                continue
            latitude, longitude, approximatif = trouve
            print(f"  {agence.nom} -> {latitude}, {longitude}" + ("  (approximatif : centre de la ville)" if approximatif else ""))
            if appliquer:
                agence.latitude, agence.longitude = latitude, longitude
            modifiees += 1
        if appliquer:
            db.commit()
            print(f"Écrit : {modifiees} agence(s) mise(s) à jour.")
        else:
            print(f"Aperçu seulement : {modifiees} agence(s) seraient mises à jour. Relancez avec --apply pour écrire.")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
