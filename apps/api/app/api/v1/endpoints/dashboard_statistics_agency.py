"""
Endpoints Dashboard — KPIs et indicateurs de satisfaction (BF-09).
"""
from uuid import UUID
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import case, func

from app.services.acces_agence import verifier_acces_agence
from app.api.deps import (
    get_admin_user,
    get_current_active_user,
    get_cx_manager,
    get_cx_or_agency_manager,
    get_db,
)
from app.models.utilisateur import Utilisateur
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.agence import Agence
from app.models.organisation import Organisation
from app.models.demande_contact import DemandeContact
from app.models.analyse_ia import AnalyseIA
from app.models.suggestion import Suggestion
from app.models.enums import UserRole, SentimentType, IdeaStatus
from app.utils.stats import wilson_lower_bound
from app.schemas.dashboard import (
    DashboardAgence,
    DashboardSiege,
    KPIAgence,
    TendanceSatisfaction,
    ThemeStats,
    SentimentStats,
    DashboardAdminStats,
    RepartitionForfaitItem,
    AdminOrganisationHierarchy,
    AdminUserItem,
    AdminAgenceItem,
    StatKPI,
    EvolutionPoint,
    ThemeStatsDetail,
    AgenceRankDetail,
    AgenceImpacteeItem,
    AlerteSyntheseDetail,
    InsightIADetail,
    OrganisationStructure,
    CompteurStructurel,
    StatsCXResponse,
    StatsAgenceResponse,
    StatsAdminResponse,
)

from app.services.dashboard_helpers import (
    _calc_kpi_trend, _cle_semaine_iso, _compter_utilisateurs_actifs, _est_traite, _kpi_taux,
    _libelles_semaines, _period_label, _repartition_forfaits, _taux,
)
from app.services.ai.recommandations import SOURCE_RECOMMANDATIONS

from app.api.v1.endpoints.dashboard_statistics_shared import THEME_LABELS_MAP

router = APIRouter()

@router.get("/statistics/agency", response_model=StatsAgenceResponse)
def get_statistics_agency(
    jours: int = Query(30, ge=1, le=365),
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Interface Statistiques & Analyses pour une agence précise : l'Agency Manager
    consulte sa propre agence (agence_id absent, retombe sur current_user.agence_id) ;
    le CX Manager peut consulter n'importe quelle agence de SON organisation en
    passant `agence_id` explicitement (page agence unifiée) — vérifié par
    verifier_acces_agence, même garde que /dashboard/agence/{agence_id}.
    """
    from collections import defaultdict
    from app.models.enums import CriticiteType

    target_agence_id = agence_id or current_user.agence_id
    if not target_agence_id:
        raise HTTPException(status_code=400, detail="Aucune agence assignée à cet utilisateur.")
    verifier_acces_agence(db, current_user, target_agence_id)

    agence = db.query(Agence).filter(Agence.id == target_agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=jours)
    previous_start = current_start - timedelta(days=jours)
    previous_end = current_start

    # QR Codes de l'agence
    qr_codes = db.query(QRCode).filter(QRCode.agence_id == agence.id).all()
    qr_ids = [q.id for q in qr_codes]

    # Feedbacks
    fbs_current = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= current_start, Feedback.date_soumission <= now)
        .all()
        if qr_ids
        else []
    )
    fbs_prev = (
        db.query(Feedback)
        .filter(Feedback.qr_code_id.in_(qr_ids), Feedback.date_soumission >= previous_start, Feedback.date_soumission < previous_end)
        .all()
        if qr_ids
        else []
    )

    cur_fb_ids = [f.id for f in fbs_current]
    prev_fb_ids = [f.id for f in fbs_prev]

    analyses_current = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(cur_fb_ids)).all()
        if cur_fb_ids
        else []
    )
    analyses_prev = (
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(prev_fb_ids)).all()
        if prev_fb_ids
        else []
    )
    analyses_cur_map = {a.feedback_id: a for a in analyses_current}
    analyses_prev_ids = {a.feedback_id for a in analyses_prev}

    total_curr = len(fbs_current)
    total_prev = len(fbs_prev)

    pos_curr = sum(1 for f in fbs_current if f.note >= 4)
    pos_prev = sum(1 for f in fbs_prev if f.note >= 4)

    # None si aucun avis sur la période (jamais 0.0) — même convention que le moteur KPI.
    sat_curr = _taux(pos_curr, total_curr)
    sat_prev = _taux(pos_prev, total_prev)

    # Feedbacks traités : MÊME définition (_est_traite) pour les deux périodes.
    def _is_treated(f: Feedback) -> bool:
        return _est_traite(f, analyses_cur_map)

    traites_curr = sum(1 for f in fbs_current if _is_treated(f))
    traites_prev = sum(1 for f in fbs_prev if _est_traite(f, analyses_prev_ids))
    attente_curr = max(0, total_curr - traites_curr)

    taux_trait_curr = _taux(traites_curr, total_curr)
    taux_trait_prev = _taux(traites_prev, total_prev)

    critiques_curr = sum(1 for a in analyses_current if a.criticite == CriticiteType.CRITIQUE)
    critiques_prev = sum(1 for a in analyses_prev if a.criticite == CriticiteType.CRITIQUE)

    tot_ev, tot_pos = _calc_kpi_trend(total_curr, total_prev)
    trt_ev, trt_pos = _calc_kpi_trend(traites_curr, traites_prev)
    crit_ev, crit_p_pos = _calc_kpi_trend(critiques_curr, critiques_prev, invert_positive=True)

    kpis = {
        "satisfaction": _kpi_taux(sat_curr, sat_prev, "Part des avis notés 4 ou 5 sur 5"),
        "total_feedbacks": StatKPI(
            valeur=total_curr,
            valeur_num=float(total_curr),
            valeur_precedente=total_prev,
            evolution=tot_ev,
            is_positive=tot_pos,
            sous_titre="Avis déposés dans votre agence",
        ),
        "feedbacks_traites": StatKPI(
            valeur=traites_curr,
            valeur_num=float(traites_curr),
            valeur_precedente=traites_prev,
            evolution=trt_ev,
            is_positive=trt_pos,
            sous_titre=(
                f"{taux_trait_curr}% des avis pris en charge"
                if taux_trait_curr is not None else "Aucun avis sur la période"
            ),
        ),
        "feedbacks_attente": StatKPI(
            valeur=attente_curr,
            valeur_num=float(attente_curr),
            valeur_precedente=max(0, total_prev - traites_prev),
            evolution=None,
            is_positive=attente_curr == 0,
            sous_titre="Avis pas encore ouverts par l'agence",
        ),
        "taux_traitement": _kpi_taux(taux_trait_curr, taux_trait_prev, "Part des avis pris en charge"),
        "alertes_critiques": StatKPI(
            valeur=critiques_curr,
            valeur_num=float(critiques_curr),
            valeur_precedente=critiques_prev,
            evolution=crit_ev,
            is_positive=crit_p_pos,
            sous_titre="Avis de gravité critique (calcul automatique)",
        ),
    }

    # Timeline
    _JOURS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    timeline_map: dict[str, dict] = defaultdict(lambda: {
        "feedbacks": 0,
        "traites": 0,
        "notes": [],
        "positifs": 0,
        "neutres": 0,
        "negatifs": 0,
        "label": "",
    })
    # Graphique de volume (evolution_volume) : uniquement les feedbacks critiques/négatifs
    # (sentiment IA négatif OU criticité élevée/critique — même définition que
    # generer_recommandations, services/ai/recommandations.py). "feedbacks" = reçus ce
    # jour-là parmi ceux-ci ; "traites" = parmi eux, ceux déjà sortis du statut "nouveau"
    # (donc ouverts par un Agency Manager). Un feedback sans analyse IA est exclu du
    # comptage plutôt que compté par défaut. Compteur séparé de timeline_map, qui reste
    # inchangé pour evolution_satisfaction (tous les feedbacks, définition "traites"
    # existante).
    volume_map: dict[str, dict] = defaultdict(lambda: {"feedbacks": 0, "traites": 0, "label": ""})

    for f in fbs_current:
        dt = f.date_soumission
        if jours <= 1:
            key = dt.strftime("%Hh")
            label = key
        elif jours <= 14:
            key = dt.strftime("%Y-%m-%d")
            label = f"{_JOURS_FR[dt.weekday()]} {dt.day}"
        elif jours <= 60:
            key = dt.strftime("%Y-%m-%d")
            label = dt.strftime("%d/%m")
        else:
            key = _cle_semaine_iso(dt)
            label = ""  # « Sem N » attribué après coup (année ajoutée si la série en couvre deux)

        timeline_map[key]["feedbacks"] += 1
        timeline_map[key]["notes"].append(f.note)
        timeline_map[key]["label"] = label
        if _is_treated(f):
            timeline_map[key]["traites"] += 1

        if f.note >= 4:
            timeline_map[key]["positifs"] += 1
        elif f.note == 3:
            timeline_map[key]["neutres"] += 1
        else:
            timeline_map[key]["negatifs"] += 1

        analyse = analyses_cur_map.get(f.id)
        if analyse and (analyse.sentiment == SentimentType.NEGATIF or analyse.criticite in (CriticiteType.ELEVEE, CriticiteType.CRITIQUE)):
            volume_map[key]["feedbacks"] += 1
            volume_map[key]["label"] = label
            if f.statut_traitement != "nouveau":
                volume_map[key]["traites"] += 1

    if jours > 60:
        libelles_sem = _libelles_semaines(timeline_map.keys())
        for k, data in timeline_map.items():
            data["label"] = libelles_sem[k]
        for k, data in volume_map.items():
            data["label"] = libelles_sem[k]

    evolution_satisfaction: list[EvolutionPoint] = []
    evolution_volume: list[EvolutionPoint] = []

    for k, data in sorted(timeline_map.items()):
        notes = data["notes"]
        # Un point n'existe que s'il contient au moins un avis : le taux est toujours défini.
        sat_pct = _taux(sum(1 for n in notes if n >= 4), len(notes))
        pt = EvolutionPoint(
            date=k,
            label=data["label"],
            feedbacks=data["feedbacks"],
            traites=data["traites"],
            satisfaction=sat_pct,
            positifs=data["positifs"],
            neutres=data["neutres"],
            negatifs=data["negatifs"],
        )
        evolution_satisfaction.append(pt)

    for k, data in sorted(volume_map.items()):
        evolution_volume.append(EvolutionPoint(
            date=k,
            label=data["label"],
            feedbacks=data["feedbacks"],
            traites=data["traites"],
        ))

    # Sentiments
    sent_counts: dict[str, int] = {"positif": 0, "neutre": 0, "negatif": 0}
    for a in analyses_current:
        s = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment).lower()
        if s in sent_counts:
            sent_counts[s] += 1
        else:
            sent_counts["neutre"] += 1

    if not analyses_current and fbs_current:
        for f in fbs_current:
            if f.note >= 4:
                sent_counts["positif"] += 1
            elif f.note == 3:
                sent_counts["neutre"] += 1
            else:
                sent_counts["negatif"] += 1

    total_sent = sum(sent_counts.values()) or 1
    sentiments_res = [
        SentimentStats(
            sentiment=k,
            count=v,
            pourcentage=round(v / total_sent * 100, 1),
        )
        for k, v in sent_counts.items()
    ]

    # Themes
    theme_agg: dict[str, dict] = defaultdict(lambda: {"count": 0, "sentiments": defaultdict(int)})
    for a in analyses_current:
        if a.theme_principal:
            th = a.theme_principal.lower().strip()
            theme_agg[th]["count"] += 1
            st = a.sentiment.value if hasattr(a.sentiment, "value") else str(a.sentiment)
            theme_agg[th]["sentiments"][st] += 1

    themes_res: list[ThemeStatsDetail] = []
    total_th_count = sum(t["count"] for t in theme_agg.values()) or 1
    for th_key, t_data in sorted(theme_agg.items(), key=lambda x: -x[1]["count"]):
        dominant_sent = max(t_data["sentiments"].items(), key=lambda x: x[1])[0] if t_data["sentiments"] else "neutre"
        themes_res.append(ThemeStatsDetail(
            theme=th_key,
            label=THEME_LABELS_MAP.get(th_key, th_key.replace("_", " ").capitalize()),
            count=t_data["count"],
            pourcentage=round(t_data["count"] / total_th_count * 100, 1),
            sentiment_predominant=dominant_sent,
        ))

    # Alertes
    impacted = []
    if critiques_curr > 0:
        impacted.append(AgenceImpacteeItem(
            agence_id=agence.id,
            agence_nom=agence.nom,
            ville=agence.ville,
            alertes_count=critiques_curr,
            satisfaction_rate=sat_curr,
        ))

    alertes_synthese = AlerteSyntheseDetail(
        total_critiques=critiques_curr,
        agences_impactees=impacted,
        evolution_pct=crit_ev,
        evolution_positive=crit_p_pos,
    )

    # Recommandations & constats. Les recommandations persistées proviennent des
    # templates de services/ai/recommandations.py (règles, aucun LLM), et les constats
    # de repli sont calculés par seuils : tout est source="regle".
    insights_ia: list[InsightIADetail] = []
    from app.models.recommandation import Recommandation
    recos = (
        db.query(Recommandation)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .filter(Feedback.id.in_(cur_fb_ids))
        .order_by(Recommandation.date_generation.desc())
        .limit(3)
        .all()
        if cur_fb_ids
        else []
    )

    for r in recos:
        insights_ia.append(InsightIADetail(
            id=str(r.id),
            type="recommandation",
            titre="Recommandation automatique",
            description=r.contenu,
            priorite=r.priorite.value if hasattr(r.priorite, "value") else str(r.priorite),
            agence_nom=agence.nom,
            date=r.date_generation.strftime("%d/%m/%Y"),
            source=SOURCE_RECOMMANDATIONS,
        ))

    if not insights_ia:
        if sat_curr is not None and sat_curr >= 80:
            insights_ia.append(InsightIADetail(
                id="agency-positive",
                type="point_fort",
                titre="Satisfaction supérieure ou égale à 80 %",
                description=f"{sat_curr}% des {total_curr} avis de la période sont notés 4 ou 5 sur 5.",
                priorite="low",
                date=now.strftime("%d/%m/%Y"),
                source="regle",
            ))
        elif sat_curr is not None:
            insights_ia.append(InsightIADetail(
                id="agency-focus",
                type="point_vigilance",
                titre="Satisfaction inférieure à 80 %",
                description=(
                    f"{sat_curr}% des {total_curr} avis de la période sont notés 4 ou 5 sur 5. "
                    f"{attente_curr} avis en attente de prise en charge."
                ),
                priorite="medium",
                date=now.strftime("%d/%m/%Y"),
                source="regle",
            ))

    return StatsAgenceResponse(
        agence_id=agence.id,
        agence_nom=agence.nom,
        ville=agence.ville,
        organisation_nom=agence.organisation.nom if agence.organisation else "Orange",
        periode_jours=jours,
        periode_label=_period_label(jours),
        kpis=kpis,
        evolution_satisfaction=evolution_satisfaction,
        evolution_volume=evolution_volume,
        sentiments=sentiments_res,
        themes=themes_res,
        alertes_synthese=alertes_synthese,
        insights_ia=insights_ia,
    )
