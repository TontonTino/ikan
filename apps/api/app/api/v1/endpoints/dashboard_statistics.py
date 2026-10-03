"""Composition des sous-routeurs statistiques du dashboard."""
from fastapi import APIRouter

from app.api.v1.endpoints.dashboard_statistics_cx import router as cx_router
from app.api.v1.endpoints.dashboard_statistics_agency import router as agency_router
from app.api.v1.endpoints.dashboard_statistics_admin import router as admin_router

router = APIRouter()
for _router in (cx_router, agency_router, admin_router):
    router.routes.extend(_router.routes)
