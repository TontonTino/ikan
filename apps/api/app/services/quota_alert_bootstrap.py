"""
Schéma des alertes de quota — SQL idempotent, partagé par la migration
Alembic 009 et le filet de démarrage (app/main.py), même principe que
plan_bootstrap.py / stripe_billing_bootstrap.py.
"""
from sqlalchemy import text


def appliquer_schema_alertes_quota(conn) -> None:
    """
    Table d'anti-spam des alertes de quota : une seule alerte par organisation,
    métrique, seuil (80 ou 100) et cycle de facturation (mois calendaire).
    cycle_facturation_debut permet de réinitialiser proprement chaque mois
    plutôt que de bloquer l'alerte pour toujours après le premier envoi.
    """
    conn.execute(text("SET LOCAL lock_timeout = '5s'"))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS alertes_quota_envoyees (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
            metrique VARCHAR(20) NOT NULL,
            seuil INTEGER NOT NULL,
            cycle_facturation_debut DATE NOT NULL,
            envoyee_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_alertes_quota_metrique CHECK (metrique IN ('feedbacks', 'agences', 'cx_managers')),
            CONSTRAINT ck_alertes_quota_seuil CHECK (seuil IN (80, 100)),
            CONSTRAINT uq_alertes_quota UNIQUE (organisation_id, metrique, seuil, cycle_facturation_debut)
        )
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_alertes_quota_organisation_id "
        "ON alertes_quota_envoyees (organisation_id)"
    ))
