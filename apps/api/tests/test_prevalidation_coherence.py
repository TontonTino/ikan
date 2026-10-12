"""
Lot 7 — prévalidation : cohérence des indicateurs d'un bout à l'autre du cycle d'un avis.

Pour un même jeu de données, une même période (30 jours) et un même périmètre (agence A1), les sources suivantes doivent
raconter la même histoire à CHAQUE étape (dépôt, prise en charge, action, résolution, réouverture) :
tableau de bord agence, statistiques agence, statistiques CX (classement), vue siège, liste des avis (X-Total-Count),
alertes. Les définitions voulues (avis négatif ≠ note faible ; analyse IA ≠ prise en charge) sont vérifiées aussi.
"""
from datetime import datetime, timedelta, timezone

from tests.test_cycle_traitement_avis import _avis, _get, ctx  # noqa: F401  (fixture réutilisée)


def _vue(ctx):
    d = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}?jours=30")
    s = _get(ctx, "am_a1", "/dashboard/statistics/agency?jours=30")["kpis"]
    c = _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")
    ligne = next(a for a in c["agences_ranking"] if a["agence_id"] == str(ctx.a1))
    siege = _get(ctx, "cx_a", "/dashboard/siege?jours=30")
    ligne_siege = next(a for a in siege["agences"] if a["agence_id"] == str(ctx.a1))
    debut = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    r = ctx.client.get("/feedbacks/", params={"agence_id": str(ctx.a1), "date_debut": debut, "limit": 200}, headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200
    alertes = _get(ctx, "am_a1", "/alertes/")["alertes_feedback"]
    return dict(d=d, s=s, c=c, ligne=ligne, ligne_siege=ligne_siege, total_liste=int(r.headers["x-total-count"]), liste=r.json(), alertes=alertes)


def _controle(v, attendu):
    d, s, ligne = v["d"], v["s"], v["ligne"]
    # Totaux : toutes les sources comptent les mêmes avis.
    assert d["nombre_feedbacks"] == s["total_feedbacks"]["valeur"] == ligne["total_feedbacks"] == v["total_liste"] == len(v["liste"]) == attendu["total"]
    assert v["ligne_siege"]["nombre_feedbacks"] == attendu["total"]
    assert v["ligne_siege"]["nombre_negatifs"] == d["nombre_negatifs"]
    # Avis négatifs : même définition partout (note ≤ 2 OU sentiment négatif, une seule fois).
    assert d["nombre_negatifs"] == s["feedbacks_negatifs"]["valeur"] == attendu["negatifs"]
    # Cycle : nouveaux + pris en charge = total ; la liste donne les mêmes effectifs.
    assert d["feedbacks_nouveaux"] + d["feedbacks_pris_en_charge"] == d["nombre_feedbacks"]
    assert d["feedbacks_nouveaux"] == attendu["nouveaux"] == sum(1 for f in v["liste"] if f["statut_traitement"] == "nouveau")
    assert d["feedbacks_resolus"] == attendu["resolus"] == sum(1 for f in v["liste"] if f["statut_traitement"] == "resolu")
    # Taux de prise en charge identique sur les trois pages.
    assert d["taux_prise_en_charge"] == s["taux_traitement"]["valeur_num"] == ligne["taux_traitement"]
    # Alertes sur avis : un avis non résolu et négatif alerte (règle inchangée), un avis résolu non.
    assert len(v["alertes"]) == attendu["alertes"]


def test_les_sources_restent_coherentes_a_chaque_etape_du_cycle(ctx):
    _avis(ctx, note=5, negatif=False)                 # positif, jamais en alerte
    _avis(ctx, note=4, analyse="attente")             # sans analyse : ni négatif ni « analysé »
    cible = _avis(ctx, note=2, negatif=True)          # note faible ET sentiment négatif : un seul avis négatif
    _avis(ctx, note=1, analyse="attente")             # note faible sans sentiment : négatif par la note

    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=4, resolus=0, alertes=2))

    # La consultation ne change rien.
    ctx.client.post(f"/feedbacks/{cible}/open", headers=ctx.H(ctx.am_a1))
    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=4, resolus=0, alertes=2))

    # Prise en charge explicite : un avis de moins en « nouveau », l'alerte demeure.
    assert ctx.client.post(f"/feedbacks/{cible}/prendre-en-charge", headers=ctx.H(ctx.am_a1)).status_code == 200
    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=3, resolus=0, alertes=2))

    # Action définie par le siège : aucun changement d'indicateur (déjà pris en charge).
    assert ctx.client.post(f"/feedbacks/{cible}/action-cx", headers=ctx.H(ctx.cx_a), json={"action": "Renforcer le guichet"}).status_code == 200
    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=3, resolus=0, alertes=2))

    # Résolution : un résolu de plus, l'alerte disparaît, l'avis reste compté comme négatif (c'est son jugement, pas son suivi).
    assert ctx.client.post(f"/feedbacks/{cible}/confirmer-action", headers=ctx.H(ctx.am_a1)).status_code == 200
    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=3, resolus=1, alertes=1))

    # Réouverture : l'avis n'est ni « nouveau » ni résolu ; l'alerte revient.
    assert ctx.client.post(f"/feedbacks/{cible}/reouvrir", headers=ctx.H(ctx.am_a1)).status_code == 200
    _controle(_vue(ctx), dict(total=4, negatifs=2, nouveaux=3, resolus=0, alertes=2))


def test_notes_faibles_et_avis_negatifs_sont_deux_indicateurs_distincts(ctx):
    _avis(ctx, note=5, negatif=True)    # négatif par le sentiment seulement
    _avis(ctx, note=2, negatif=False)   # note faible, sentiment positif
    _avis(ctx, note=3, negatif=False)
    kpis = _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")["kpis"]
    assert kpis["feedbacks_negatifs"]["valeur"] == 2       # sentiment négatif OU note faible
    assert kpis["feedbacks_notes_faibles"]["valeur"] == 1  # notes 1-2 uniquement


def test_etats_vides_distincts_des_erreurs(ctx):
    d = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}?jours=30")
    assert d["nombre_feedbacks"] == 0 and d["taux_satisfaction"] is None and d["taux_prise_en_charge"] is None
    assert _get(ctx, "am_a1", "/alertes/")["alertes_feedback"] == []
    # Une agence qui n'est pas la sienne n'est PAS un « état vide » : c'est un refus.
    assert ctx.client.get(f"/dashboard/agence/{ctx.a2}", headers=ctx.H(ctx.am_a1)).status_code == 403
