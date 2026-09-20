"""
Schéma Stripe/facturation — SQL idempotent, partagé par la migration Alembic 007
et le filet de démarrage (app/main.py), même principe que plan_bootstrap.py.
Peut être rejoué sans effet de bord.
"""
from sqlalchemy import text


def appliquer_schema_stripe(conn) -> None:
    """Ajoute les colonnes Stripe sur organisations et crée la table changements_plan."""
    conn.execute(text("SET LOCAL lock_timeout = '5s'"))

    conn.execute(text(
        "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) NULL"
    ))
    conn.execute(text(
        "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) NULL"
    ))
    conn.execute(text(
        "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS stripe_subscription_status VARCHAR(50) NULL"
    ))
    conn.execute(text(
        "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ NULL"
    ))
    # Index uniques partiels (ignorent les NULL) : deux organisations ne peuvent
    # jamais partager le même client/abonnement Stripe, mais rien n'empêche une
    # organisation de ne pas encore en avoir.
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_stripe_customer_id "
        "ON organisations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL"
    ))
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_stripe_subscription_id "
        "ON organisations (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL"
    ))

    # Journal d'audit de tout changement de forfait (Stripe, override Admin,
    # dégradation automatique) — utilisé à partir de la Phase 2 (webhook) et
    # de la Phase 3 (override Admin), créée dès maintenant pour n'avoir qu'une
    # seule migration à appliquer sur Supabase.
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS changements_plan (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            ancien_plan_id UUID NULL REFERENCES plans(id),
            nouveau_plan_id UUID NOT NULL REFERENCES plans(id),
            raison TEXT NULL,
            modifie_par_id UUID NULL REFERENCES utilisateurs(id) ON DELETE SET NULL,
            source VARCHAR(20) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_changements_plan_source CHECK (source IN ('stripe', 'admin_override', 'auto_downgrade'))
        )
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_changements_plan_organisation_id "
        "ON changements_plan (organisation_id)"
    ))


def appliquer_schema_webhook_events(conn) -> None:
    """
    Table d'idempotence des événements webhook Stripe déjà traités — Stripe
    documente explicitement pouvoir renvoyer le même événement plusieurs fois
    (au moins une livraison, jamais garanti exactement une seule).
    """
    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS stripe_events_traites (
            event_id VARCHAR(255) PRIMARY KEY,
            traite_le TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
