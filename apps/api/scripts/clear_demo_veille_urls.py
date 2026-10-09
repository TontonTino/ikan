"""Retire les liens source fictifs des 20 mentions Veille de démo (Orange Burkina Faso).

Ne touche QUE les lignes dont external_id fait partie de la liste explicite ci-dessous
(demo-orange-bf-veille-0001 à 0020, créées par seed_mentions_veille_demo.py), dans la
seule organisation « Orange Burkina Faso ». Par défaut : aperçu sans écriture. Avec
--apply : mise à jour dans une transaction, annulée si le nombre de lignes n'est pas 20.

Usage (depuis apps/api) :
    python scripts/clear_demo_veille_urls.py           # aperçu
    python scripts/clear_demo_veille_urls.py --apply   # écriture
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import bindparam, text

from app.db.session import SessionLocal


ORG_NAME = "Orange Burkina Faso"
DEMO_EXTERNAL_IDS = [f"demo-orange-bf-veille-{index:04d}" for index in range(1, 21)]

SELECT_SQL = text(
    """
    SELECT m.external_id, m.url_source
    FROM mentions_veille m
    JOIN organisations o ON o.id = m.organisation_id
    WHERE o.nom = :org_name
      AND m.plateforme = 'facebook'
      AND m.external_id IN :external_ids
    ORDER BY m.external_id
    """
).bindparams(bindparam("external_ids", expanding=True))

UPDATE_SQL = text(
    """
    UPDATE mentions_veille
    SET url_source = NULL
    WHERE organisation_id = (SELECT id FROM organisations WHERE nom = :org_name)
      AND plateforme = 'facebook'
      AND external_id IN :external_ids
    """
).bindparams(bindparam("external_ids", expanding=True))


def main() -> int:
    apply = "--apply" in sys.argv[1:]
    params = {"org_name": ORG_NAME, "external_ids": DEMO_EXTERNAL_IDS}
    db = SessionLocal()
    try:
        orgs = db.execute(text("SELECT count(*) FROM organisations WHERE nom = :org_name"), params).scalar_one()
        if orgs != 1:
            print(f"Référence non sûre : {orgs} organisations nommées {ORG_NAME!r} ; rien n'est modifié.")
            return 1

        rows = db.execute(SELECT_SQL, params).all()
        print(f"Mentions de démo trouvées : {len(rows)} / {len(DEMO_EXTERNAL_IDS)}")
        for external_id, url_source in rows:
            print(f"  {external_id}  url_source={url_source!r}")
        if not apply:
            print("Aperçu uniquement (aucune écriture). Relancer avec --apply pour mettre à jour.")
            return 0

        result = db.execute(UPDATE_SQL, params)
        if result.rowcount != len(DEMO_EXTERNAL_IDS):
            db.rollback()
            print(f"{result.rowcount} lignes touchées au lieu de {len(DEMO_EXTERNAL_IDS)} : annulation, rien n'est modifié.")
            return 1
        db.commit()
        print(f"{result.rowcount} mentions de démo mises à jour (url_source = NULL).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
