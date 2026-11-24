"""
Démonstration publique — copie de référence et remise à zéro de la base de démo (docs/demo-publique.md).

    python scripts/demo_remettre_a_zero.py capturer  --fichier /home/ec2-user/ikan-demo/reference.dump
    python scripts/demo_remettre_a_zero.py restaurer --fichier /home/ec2-user/ikan-demo/reference.dump

capturer   enregistre l'état actuel de la base de démo (pg_dump) comme état « propre », avec sa date de capture.
restaurer  remet la base de démo exactement dans cet état (pg_restore + psql), puis AVANCE toutes les dates du nombre de jours écoulés depuis la
           capture : un avis capturé « il y a 3 jours » reste « il y a 3 jours » un mois plus tard, et les vues « 30 derniers jours »
           ne se vident jamais. Lancé chaque nuit par ikan-demo-remise-a-zero.timer.

La base visée est DATABASE_URL, lue comme par l'API (environnement, puis apps/api/.env). Garde-fous, AVANT toute connexion :
 - DEMO_MODE doit valoir « oui » : on ne remet à zéro qu'une configuration de démonstration ;
 - la base de PRODUCTION protégée est TOUJOURS refusée, sans aucun contournement (pas même IKAN_AUTORISER_PRODUCTION).
Aucun mot de passe ni adresse complète n'est jamais affiché.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.core.config import settings  # noqa: E402
from app.core.demo import demo_active  # noqa: E402
from app.core.garde_production import est_base_de_production, refuser_si_production  # noqa: E402

TYPES_DATE = ("timestamp without time zone", "timestamp with time zone", "date")
# Journal d'audit : ajout seul, protégé par un déclencheur qui refuse tout UPDATE (migration 033). On ne le contourne pas : ses
# dates restent celles de la capture.
TABLES_SANS_DECALAGE = frozenset({"journal_audit"})


class RemiseRefusee(RuntimeError):
    """Refus avant toute connexion ; le message est destiné à l'utilisateur."""


def adresse_libpq(database_url: str) -> str:
    """postgresql+psycopg2://… (forme SQLAlchemy) → postgresql://… (forme comprise par pg_dump / pg_restore / psycopg)."""
    schema, separateur, reste = database_url.partition("://")
    if not separateur:
        raise RemiseRefusee("DATABASE_URL n'est pas une adresse PostgreSQL.")
    schema = schema.split("+", 1)[0]
    if schema not in ("postgresql", "postgres"):
        raise RemiseRefusee("DATABASE_URL n'est pas une adresse PostgreSQL.")
    return f"postgresql://{reste}"


def verifier_cible(database_url: str) -> str:
    if not demo_active():
        raise RemiseRefusee("Refusé : DEMO_MODE n'est pas « oui ». Ce script ne touche qu'à la base d'une démonstration. Rien n'a été modifié.")
    if est_base_de_production(database_url):
        raise RemiseRefusee("Refusé : DATABASE_URL vise la base de PRODUCTION. Aucune connexion n'a été ouverte, rien n'a été modifié.")
    return adresse_libpq(database_url)


def fichier_date(fichier: Path) -> Path:
    return fichier.with_suffix(fichier.suffix + ".json")


def capturer(adresse: str, fichier: Path) -> None:
    fichier.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=fichier.parent, prefix=".capture-", delete=False) as tmp:
        provisoire = Path(tmp.name)
    try:
        subprocess.run(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", f"--file={provisoire}", f"--dbname={adresse}"],
                       check=True)
        provisoire.replace(fichier)          # jamais de copie à moitié écrite à la place de la bonne
    finally:
        provisoire.unlink(missing_ok=True)
    capture = datetime.now(timezone.utc)
    fichier_date(fichier).write_text(json.dumps({"capture": capture.isoformat()}), encoding="utf-8")
    print(f"Copie de référence enregistrée : {fichier} (capture du {capture:%d/%m/%Y %H:%M} UTC).")


def jours_ecoules(fichier: Path, maintenant: datetime) -> int:
    capture = datetime.fromisoformat(json.loads(fichier_date(fichier).read_text(encoding="utf-8"))["capture"])
    return max(0, (maintenant - capture).days)


def requetes_decalage(colonnes, jours: int) -> list:
    """Une requête UPDATE par table, toutes ses colonnes de date avancées de `jours` jours (NULL reste NULL)."""
    par_table = {}
    for table, colonne in colonnes:
        if table in TABLES_SANS_DECALAGE:
            continue
        par_table.setdefault(table, []).append(colonne)
    requetes = []
    for table in sorted(par_table):
        affectations = ", ".join(f'"{c}" = "{c}" + interval \'{int(jours)} days\'' for c in sorted(par_table[table]))
        requetes.append(f'UPDATE "public"."{table}" SET {affectations}')
    return requetes


def restaurer(adresse: str, fichier: Path) -> None:
    if not fichier.exists() or not fichier_date(fichier).exists():
        raise RemiseRefusee(f"Copie de référence introuvable ({fichier}). Lancez d'abord la commande « capturer ». Rien n'a été modifié.")
    jours = jours_ecoules(fichier, datetime.now(timezone.utc))

    # Schéma public vidé PUIS recréé depuis la copie, dans UNE transaction (psql --single-transaction) : rien ne survit d'une
    # visite (pas même une table ajoutée après la capture), et en cas d'échec la base reste telle qu'elle était.
    script = subprocess.run(["pg_restore", "--no-owner", "--no-privileges", "--file=-", str(fichier)],
                            check=True, capture_output=True).stdout
    subprocess.run(["psql", "--quiet", "--no-psqlrc", "--single-transaction", "-v", "ON_ERROR_STOP=1", f"--dbname={adresse}"],
                   input=b"DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n" + script, check=True,
                   stdout=subprocess.DEVNULL)

    import psycopg

    with psycopg.connect(adresse) as connexion:          # une seule transaction : tout ou rien
        colonnes = connexion.execute(
            "SELECT table_name, column_name FROM information_schema.columns c "
            "JOIN information_schema.tables t USING (table_schema, table_name) "
            "WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.data_type = ANY(%s)",
            (list(TYPES_DATE),),
        ).fetchall()
        if jours:
            for requete in requetes_decalage(colonnes, jours):
                connexion.execute(requete)
    print(f"Démonstration remise à zéro ; dates avancées de {jours} jour(s) sur {len({t for t, _ in colonnes})} table(s).")


def main(argv=None) -> int:
    # Garde SD-02 commune, avant même la lecture des arguments ; verifier_cible() ajoute un refus SANS contournement possible.
    refuser_si_production(settings.DATABASE_URL, "remise à zéro de la démonstration")
    parseur = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parseur.add_argument("action", choices=("capturer", "restaurer"))
    parseur.add_argument("--fichier", required=True, type=Path, help="copie de référence (ex. /home/ec2-user/ikan-demo/reference.dump)")
    args = parseur.parse_args(argv)
    try:
        adresse = verifier_cible(settings.DATABASE_URL or os.environ.get("DATABASE_URL", ""))
        (capturer if args.action == "capturer" else restaurer)(adresse, args.fichier)
    except RemiseRefusee as refus:
        print(str(refus), file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as erreur:
        print(f"Échec de {erreur.cmd[0]} (code {erreur.returncode}) : voir le message ci-dessus.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
