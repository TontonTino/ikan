"""
Schéma et données des forfaits — SQL idempotent, partagé par la migration
Alembic 006 et le filet de démarrage (app/main.py) pour que les deux
appliquent strictement la même logique. Peut être rejoué sans effet de bord.
"""
from sqlalchemy import text

from app.services.plan_catalog import (
    PLANS,
    PLAN_FEATURES,
    PLAN_ENTREPRISE_ID,
    PLAN_GRATUIT_ID,
)

ORGANISATION_DEMO_ENTREPRISE = "Orange Burkina Faso"


def appliquer_schema_plans(conn) -> None:
    """Crée les tables, les données de base et rattache les organisations existantes."""
    # Ne jamais faire attendre le démarrage de l'API derrière un verrou : en cas
    # de contention, l'exception est journalisée par l'appelant (le filet est
    # rejoué au démarrage suivant, la migration Alembic reste la voie principale).
    conn.execute(text("SET LOCAL lock_timeout = '5s'"))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS plans (
            id UUID PRIMARY KEY,
            code VARCHAR(50) NOT NULL UNIQUE,
            nom VARCHAR(100) NOT NULL,
            ordre INTEGER NOT NULL DEFAULT 0,
            max_cx_managers INTEGER NULL,
            max_agences INTEGER NULL,
            max_feedbacks_mois INTEGER NULL
        )
    """))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS plan_features (
            id UUID PRIMARY KEY,
            plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
            feature_code VARCHAR(80) NOT NULL,
            CONSTRAINT uq_plan_feature UNIQUE (plan_id, feature_code)
        )
    """))

    for code, (plan_id, nom, ordre, max_cx, max_ag, max_fb) in PLANS.items():
        conn.execute(
            text("""
                INSERT INTO plans (id, code, nom, ordre, max_cx_managers, max_agences, max_feedbacks_mois)
                VALUES (:id, :code, :nom, :ordre, :cx, :ag, :fb)
                ON CONFLICT (code) DO NOTHING
            """),
            {"id": plan_id, "code": code, "nom": nom, "ordre": ordre, "cx": max_cx, "ag": max_ag, "fb": max_fb},
        )

    for code, features in PLAN_FEATURES.items():
        plan_id = PLANS[code][0]
        for feature in features:
            conn.execute(
                text("""
                    INSERT INTO plan_features (id, plan_id, feature_code)
                    VALUES (gen_random_uuid(), :plan_id, :feature)
                    ON CONFLICT (plan_id, feature_code) DO NOTHING
                """),
                {"plan_id": plan_id, "feature": feature},
            )

    # Déjà appliqué (cas normal à chaque redémarrage) : aucun ALTER, donc aucun
    # verrou exclusif sur la table organisations.
    etat = conn.execute(text("""
        SELECT is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'organisations' AND column_name = 'plan_id'
    """)).first()
    if etat is not None and etat.is_nullable == "NO" and etat.column_default and str(PLAN_GRATUIT_ID) in etat.column_default:
        return

    conn.execute(text(
        "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id)"
    ))
    # Toute NOUVELLE organisation démarre en Gratuit.
    conn.execute(text(
        f"ALTER TABLE organisations ALTER COLUMN plan_id SET DEFAULT '{PLAN_GRATUIT_ID}'"
    ))
    # Organisation de démo : Entreprise explicitement, puis toute organisation
    # existante non rattachée est aussi passée en Entreprise (aucune régression
    # pour l'existant : seules les organisations créées ensuite partent en Gratuit).
    conn.execute(
        text("UPDATE organisations SET plan_id = :p WHERE nom = :nom AND plan_id IS NULL"),
        {"p": PLAN_ENTREPRISE_ID, "nom": ORGANISATION_DEMO_ENTREPRISE},
    )
    conn.execute(
        text("UPDATE organisations SET plan_id = :p WHERE plan_id IS NULL"),
        {"p": PLAN_ENTREPRISE_ID},
    )
    conn.execute(text("ALTER TABLE organisations ALTER COLUMN plan_id SET NOT NULL"))
