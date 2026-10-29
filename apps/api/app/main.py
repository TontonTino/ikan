"""
Point d'entrée principal de l'API IKAN AI.
"""
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.core.body_limit import LimiteCorpsPublic
from app.core.cors import appliquer_cors
from app.core.csrf import ProtectionCSRF
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.journal_acces import installer_journal_acces
from app.core.masquage_acces_http import installer_masquage_acces_http
from app.utils.masquage import masquer_contacts
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

logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Plateforme SaaS de Feedback Client — IKAN AI",
    version="1.0.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs",
    redoc_url=f"{settings.API_V1_STR}/redoc",
)

scheduler = BackgroundScheduler()

# Journal des 401/403 (SD-10) : un seul point, voir app/core/journal_acces.py.
installer_journal_acces(app)
# Le journal d'accès d'uvicorn ne doit pas contenir les termes recherchés (?q=…).
installer_masquage_acces_http()
# Les 422 ne renvoient jamais les valeurs saisies (mots de passe) : voir app/core/erreurs_validation.py.
installer_erreurs_validation(app)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Ni l'objet exception ni sa trace complète : le message d'une erreur SQL embarque les paramètres de la requête
    # (texte d'un avis, téléphone, e-mail). On garde le type, un message masqué et les emplacements dans le code.
    emplacements = " <- ".join(
        f"{f.filename.rsplit('/', 1)[-1].rsplit(chr(92), 1)[-1]}:{f.lineno}" for f in traceback.extract_tb(exc.__traceback__)[-4:]
    )
    logger.error(
        "Erreur non gérée pendant %s %s : %s (%s) [%s]",
        request.method,
        request.url.path,
        type(exc).__name__,
        masquer_contacts(str(exc))[:200],
        emplacements,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Une erreur interne est survenue."},
    )

@app.on_event("startup")
def on_startup():
    """Création automatique des tables (développement uniquement), migration DDL et auto-seeding."""
    if settings.APP_ENV == "development":
        print(f"[STARTUP] APP_ENV='{settings.APP_ENV}' — Base.metadata.create_all() exécuté.")
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as e:
            print(f"[STARTUP DB MIGRATION LOG] {e}")
    else:
        print(f"[STARTUP] APP_ENV='{settings.APP_ENV}' — Base.metadata.create_all() IGNORÉ "
              f"(le schéma ne vient que de `alembic upgrade head`).")

    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS logo TEXT;"))
            # Plus de défaut 'Télécommunications' (voir secteur_code, app/services/secteurs.py,
            # migration 023_organisation_secteur_code — seule source désormais).
            conn.execute(text("ALTER TABLE organisations ADD COLUMN IF NOT EXISTS secteur_activite VARCHAR(100);"))
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

    # Aucun seed au démarrage, dans AUCUN environnement : le démarrage ne crée ni ne supprime jamais
    # d'utilisateurs, d'agences ni d'organisations. Les données de démonstration se chargent à la main,
    # en local uniquement : `python seed.py` (voir apps/api/README.md et seed.py).

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

_origines_cors = settings.allowed_origins_list
# Ligne de démarrage : origines publiques uniquement, aucun secret.
print(f"[CORS] APP_ENV={settings.APP_ENV} origines autorisées : {', '.join(_origines_cors)}")
# Plafond de taille du corps des envois publics (POST /feedbacks, /feedbacks/{id}/nps). Ajouté AVANT le CORS : le CORS
# l'enveloppe, donc un refus 413 porte les en-têtes CORS et reste lisible par le navigateur.
app.add_middleware(LimiteCorpsPublic)
# CSRF (SD-08) : posé APRÈS le plafond de corps et AVANT le CORS, pour qu'un refus 403 porte lui aussi les en-têtes CORS.
app.add_middleware(ProtectionCSRF)
appliquer_cors(app, _origines_cors)

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
