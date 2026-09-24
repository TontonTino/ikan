"""
Point d'entrée principal de l'API IKAN AI.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.api.v1.router import api_router
from app.db.session import engine, Base, SessionLocal
import app.models.organisation
import app.models.agence
import app.models.utilisateur
import app.models.qr_code
import app.models.feedback
import app.models.analyse_ia
import app.models.suggestion
import app.models.demande_contact
import app.models.historique_action
import app.models.system_settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Plateforme SaaS de Feedback Client — IKAN AI",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
)

scheduler = BackgroundScheduler()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    err_trace = traceback.format_exc()
    print(f"[GLOBAL EXCEPTION] {err_trace}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Erreur serveur interne: {str(exc)}", "trace": err_trace[-400:]}
    )

@app.on_event("startup")
def on_startup():
    """Création automatique des tables, migration DDL et auto-seeding si la base de prod est vide."""
    try:
        Base.metadata.create_all(bind=engine)
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS logo TEXT;"))
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS secteur_activite VARCHAR(100) DEFAULT 'Télécommunications';"))
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS pays_region VARCHAR(100) DEFAULT 'Tunisie / Afrique du Nord';"))
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS email_pro VARCHAR(255);"))
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();"))
            conn.execute(text("ALTER TABLE organisations ALTER COLUMN logo TYPE TEXT;"))
            conn.execute(text("ALTER TABLE organisations ALTER COLUMN secteur DROP NOT NULL;"))
            conn.execute(text("ALTER TABLE organisations ALTER COLUMN email DROP NOT NULL;"))
            conn.execute(text("UPDATE organisations SET secteur_activite = secteur WHERE secteur_activite IS NULL AND secteur IS NOT NULL;"))
            conn.execute(text("UPDATE organisations SET email_pro = email WHERE email_pro IS NULL AND email IS NOT NULL;"))
            conn.execute(text("UPDATE organisations SET created_at = date_creation WHERE created_at IS NULL AND date_creation IS NOT NULL;"))
    except Exception as e:
        print(f"[STARTUP DB MIGRATION LOG] {e}")

    # Filet forfaits (même SQL idempotent que la migration Alembic 006).
    try:
        from app.services.plan_bootstrap import appliquer_schema_plans
        with engine.begin() as conn:
            appliquer_schema_plans(conn)
    except Exception as e:
        print(f"[STARTUP PLANS LOG] {e}")

    # Filet Stripe/facturation (même SQL idempotent que la migration Alembic 007).
    try:
        from app.services.stripe_billing_bootstrap import appliquer_schema_stripe
        with engine.begin() as conn:
            appliquer_schema_stripe(conn)
    except Exception as e:
        print(f"[STARTUP STRIPE LOG] {e}")

    # Filet idempotence webhook Stripe (même SQL idempotent que la migration Alembic 008).
    try:
        from app.services.stripe_billing_bootstrap import appliquer_schema_webhook_events
        with engine.begin() as conn:
            appliquer_schema_webhook_events(conn)
    except Exception as e:
        print(f"[STARTUP STRIPE WEBHOOK LOG] {e}")

    # Filet alertes de quota (même SQL idempotent que la migration Alembic 009).
    try:
        from app.services.quota_alert_bootstrap import appliquer_schema_alertes_quota
        with engine.begin() as conn:
            appliquer_schema_alertes_quota(conn)
    except Exception as e:
        print(f"[STARTUP QUOTA ALERTS LOG] {e}")

    # Auto-seeding si aucun QR Code n'existe en base
    try:
        db = SessionLocal()
        from app.models.qr_code import QRCode
        count = db.query(QRCode).count()
        db.close()
        if count == 0:
            print("[STARTUP SEED] Aucune donnée détectée. Seeding automatique en cours...")
            from seed import seed_database
            seed_database()
            print("[STARTUP SEED] Seeding automatique terminé avec succès !")
    except Exception as e:
        print(f"[STARTUP SEED LOG ERROR] {e}")

    # Jobs quotidiens — même scheduler pour tous (pas d'instance séparée par job).
    # Chaque enregistrement est indépendant : l'échec de l'un n'empêche jamais
    # les autres d'être planifiés.
    from apscheduler.triggers.cron import CronTrigger

    try:
        from app.services.stripe_downgrade_job import degrader_organisations_en_echec_de_paiement
        scheduler.add_job(
            degrader_organisations_en_echec_de_paiement,
            CronTrigger(hour=3, minute=0),
            id="degradation_paiement_echoue",
            replace_existing=True,
        )
        print("[STARTUP SCHEDULER] Job de dégradation automatique planifié (tous les jours à 3h).")
    except Exception as e:
        print(f"[STARTUP SCHEDULER LOG ERROR] {e}")

    try:
        from app.services.quota_alert_job import envoyer_alertes_quota
        scheduler.add_job(
            envoyer_alertes_quota,
            CronTrigger(hour=4, minute=0),
            id="alertes_quota",
            replace_existing=True,
        )
        print("[STARTUP SCHEDULER] Job d'alertes de quota planifié (tous les jours à 4h).")
    except Exception as e:
        print(f"[STARTUP SCHEDULER LOG ERROR] {e}")

    try:
        if not scheduler.running:
            scheduler.start()
    except Exception as e:
        print(f"[STARTUP SCHEDULER LOG ERROR] {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusion des routes
app.include_router(api_router, prefix=settings.API_V1_STR)

# Webhook Stripe — hors /api/v1 (URL fixe à enregistrer telle quelle dans Stripe),
# public, authentifié uniquement par la signature Stripe (voir app/api/webhooks_stripe.py).
from app.api.webhooks_stripe import router as webhooks_stripe_router
app.include_router(webhooks_stripe_router, prefix="/webhooks", tags=["Webhooks"])


@app.on_event("shutdown")
def arreter_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)


@app.get("/")
def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": "1.0.0",
        "docs": f"{settings.API_V1_STR}/docs",
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/schema")
def health_schema():
    """
    SONDE TEMPORAIRE (déploiement expand/contract de delai_alerte_negatif_heures) : indique si la
    migration 014 est bien appliquée. Volontairement séparée de /health (healthCheckPath de Render).
    À retirer une fois le déploiement confirmé.
    """
    try:
        from sqlalchemy import inspect
        from app.db.session import engine

        colonnes = {c["name"] for c in inspect(engine).get_columns("utilisateurs")}
        return {"delai_alerte_negatif_heures": "delai_alerte_negatif_heures" in colonnes}
    except Exception as e:  # sonde de diagnostic : ne doit jamais lever
        return {"erreur": type(e).__name__}


@app.get("/debug-db")
def debug_db():
    try:
        from app.db.session import engine
        from sqlalchemy import text
        with engine.connect() as conn:
            res = conn.execute(text("SELECT 1")).fetchone()
            return {"status": "connected", "result": res[0]}
    except Exception as e:
        import traceback
        return {"status": "error", "error": str(e), "trace": traceback.format_exc()}
