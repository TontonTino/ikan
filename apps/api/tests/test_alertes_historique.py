"""
Historique des épisodes d'alerte de seuil (cycle de vie des alertes, PR 4/5) : GET /alertes/episodes et GET /alertes/episodes/{id}.

Vrai routeur, vraie authentification JWT, SQLite en mémoire, deux organisations. LECTURE SEULE : aucune écriture, aucune réconciliation.
Règle des 48 h du CX Manager (même règle que GET /alertes/), portée, filtres, pagination par curseur, durées jamais certaines.
Le plan d'exécution (EXPLAIN) sur un vrai PostgreSQL est dans test_alertes_historique_postgres.py.
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-historique-0123456789")

import pytest

from app.api.v1.endpoints import alertes
from app.core.security import create_access_token
from app.models.alerte_episode import AlerteEpisode
from app.models.journal_audit import JournalAudit
from app.models.utilisateur import Utilisateur
from app.services import alertes_episodes as ep

from tests.test_alertes_episodes import ctx  # noqa: F401  (même jeu de données : deux organisations, A1 et B1 sous leur seuil)
from tests.test_alertes_prise_en_charge import ajouter_am

UTC = timezone.utc
T = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
CHAMPS_LISTE = {
    "episode_id", "agence_id", "agence_nom", "type", "statut", "gravite_ouverture", "detecte_le", "debut_condition", "debut_approximatif",
    "debut_remontee_limitee", "fin_condition", "terminee_le", "fin_cause", "duree_minutes", "duree_approximative", "duree_minimale", "duree_en_cours",
    "taux_ouverture", "seuil_ouverture", "taux_fermeture", "seuil_fermeture", "pris_en_charge_le", "pris_en_charge_par_nom",
}
CHAMPS_DETAIL = CHAMPS_LISTE | {"commentaire_prise_en_charge", "delai_prise_en_charge_minutes", "created_at"}


def entete(utilisateur_id):
    return {"Authorization": f"Bearer {create_access_token(utilisateur_id)}"}


def liste(ctx, acteur_id, **params):
    return ctx.client.get("/alertes/episodes", params=params, headers=entete(acteur_id) if acteur_id else {})


def detail(ctx, episode_id, acteur_id):
    return ctx.client.get(f"/alertes/episodes/{episode_id}", headers=entete(acteur_id) if acteur_id else {})


def creer(ctx, *, agence="a1", debut_h, duree_h=None, statut=None, maintenant=None, **extra):
    """Insère directement un épisode : ouvert (duree_h absent) ou terminé (il a duré `duree_h` heures). Retourne son identifiant."""
    maintenant = maintenant or datetime.now(UTC)
    debut = maintenant - timedelta(hours=debut_h)
    organisation = ctx.org_b if agence.startswith("b") else ctx.org_a
    valeurs = dict(id=uuid4(), organisation_id=organisation, agence_id=getattr(ctx, agence), debut_condition=debut,
                   detecte_le=debut + timedelta(minutes=5), taux_ouverture=40.0, seuil_ouverture=70.0, gravite_ouverture="critique",
                   created_at=debut + timedelta(minutes=5), updated_at=debut + timedelta(minutes=5))
    if duree_h is not None:
        fin = debut + timedelta(hours=duree_h)
        valeurs.update(statut="terminee", fin_condition=fin, terminee_le=fin + timedelta(minutes=5), fin_cause="retablie", taux_fermeture=80.0, seuil_fermeture=70.0)
    elif statut == "prise_en_charge":
        valeurs.update(statut="prise_en_charge", pris_en_charge_le=debut + timedelta(minutes=35), pris_en_charge_par_nom="Awa Traoré",
                       commentaire_prise_en_charge="Rappel prévu demain")
    valeurs.update(extra)
    ctx.modifier(lambda s: s.add(AlerteEpisode(**valeurs)))
    return valeurs["id"]


def identifiants(reponse):
    return [e["episode_id"] for e in reponse.json()["episodes"]]


@pytest.fixture()
def h(ctx, monkeypatch):  # noqa: F811
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)       # le forfait n'est pas l'objet de ces tests (voir test_forfait_sans_alertes)
    ctx.am_a2 = ajouter_am(ctx, ctx.a2, ctx.org_a)
    return ctx


# ── Matrice des rôles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_matrice_des_roles_liste_et_detail(h):
    mien = creer(h, debut_h=100, duree_h=60)                       # épisode terminé de A1 (org A), visible du CX (60 h)
    autre_org = creer(h, agence="b1", debut_h=100, duree_h=60)     # épisode de B1 (org B)
    inconnu = detail(h, uuid4(), h.am_a1)
    assert inconnu.status_code == 404
    assert liste(h, h.am_a1).status_code == 200 and liste(h, h.cx_a).status_code == 200
    assert detail(h, mien, h.am_a1).status_code == 200 and detail(h, mien, h.cx_a).status_code == 200
    for acteur in (h.admin,):                                       # l'Administrateur est refusé partout
        assert liste(h, acteur).status_code == 403 and detail(h, mien, acteur).status_code == 403
    assert liste(h, None).status_code == 401 and detail(h, mien, None).status_code == 401
    assert detail(h, "pas-un-uuid", h.am_a1).status_code == 422
    # Hors périmètre : 404 IDENTIQUE à un identifiant inconnu (même corps), jamais 403 ni 200.
    for nom, r in {"AM d'une autre agence (même organisation)": detail(h, mien, h.am_a2),
                   "AM d'une autre organisation": detail(h, mien, h.am_b1),
                   "CX d'une autre organisation": detail(h, mien, h.cx_b),
                   "AM de A1 sur un épisode de B1": detail(h, autre_org, h.am_a1),
                   "CX de A sur un épisode de B1": detail(h, autre_org, h.cx_a)}.items():
        assert r.status_code == 404 and r.json() == inconnu.json(), nom


def test_forfait_sans_alertes(h, monkeypatch):
    mien = creer(h, debut_h=100, duree_h=60)
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: False)
    r = liste(h, h.am_a1)
    assert r.status_code == 200 and r.json()["episodes"] == [] and r.json()["alertes_incluses"] is False and r.json()["episodes_disponibles"] is False
    assert detail(h, mien, h.am_a1).status_code == 403


def test_interrupteur_coupe(h, monkeypatch):
    mien = creer(h, debut_h=100, duree_h=60)
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "non")
    r = liste(h, h.am_a1)
    assert r.status_code == 200 and r.json()["episodes"] == [] and r.json()["episodes_disponibles"] is False
    assert detail(h, mien, h.am_a1).status_code == 404


# ── Isolation : portée et absence de fuite ────────────────────────────────────────────────────────────────────────────────────────────

def test_portee_agency_manager_cx_manager_et_organisations(h):
    a1 = creer(h, debut_h=200, duree_h=60)
    a2 = creer(h, agence="a2", debut_h=150, duree_h=60)
    b1 = creer(h, agence="b1", debut_h=100, duree_h=60)
    assert set(identifiants(liste(h, h.am_a1))) == {str(a1)}                         # Agency Manager : sa seule agence
    assert set(identifiants(liste(h, h.am_a2))) == {str(a2)}
    assert set(identifiants(liste(h, h.cx_a))) == {str(a1), str(a2)}                 # CX Manager : son organisation
    assert set(identifiants(liste(h, h.cx_b))) == {str(b1)} and set(identifiants(liste(h, h.am_b1))) == {str(b1)}


def test_aucune_fuite_d_une_autre_organisation_dans_les_reponses(h):
    creer(h, debut_h=200, duree_h=60)
    b1 = creer(h, agence="b1", debut_h=100, duree_h=60, commentaire_prise_en_charge="SECRET-B", pris_en_charge_par_nom="Secret Bé")
    for r in (liste(h, h.am_a1), liste(h, h.cx_a), liste(h, h.cx_a, agence_id=str(h.a1)), detail(h, b1, h.cx_a), detail(h, b1, h.am_a1)):
        corps = r.text
        assert str(b1) not in corps and str(h.b1) not in corps and "Agence B1" not in corps and "SECRET-B" not in corps and "Secret Bé" not in corps and str(h.org_b) not in corps


def test_le_curseur_d_une_organisation_n_ouvre_rien_d_une_autre(h):
    for decalage in (200, 190, 180):
        creer(h, debut_h=decalage, duree_h=60)
        creer(h, agence="b1", debut_h=decalage, duree_h=60)
    page = liste(h, h.cx_a, limite=1).json()
    assert page["curseur_suivant"]
    reponses = liste(h, h.cx_b, limite=100, curseur=page["curseur_suivant"]).json()["episodes"]
    assert all(e["agence_id"] == str(h.b1) for e in reponses)


def test_filtre_agence_hors_perimetre_ou_inconnue_404_identique(h):
    creer(h, debut_h=200, duree_h=60)
    inconnue = liste(h, h.cx_a, agence_id=str(uuid4()))
    assert inconnue.status_code == 404
    assert liste(h, h.cx_a, agence_id=str(h.b1)).json() == inconnue.json() and liste(h, h.cx_a, agence_id=str(h.b1)).status_code == 404
    assert liste(h, h.am_a1, agence_id=str(h.a2)).status_code == 404 and liste(h, h.am_a1, agence_id=str(h.a2)).json() == inconnue.json()
    assert liste(h, h.am_a1, agence_id=str(h.a1)).status_code == 200


# ── Contenu : champs, durées jamais certaines ─────────────────────────────────────────────────────────────────────────────────────────

def test_champs_de_la_liste_et_du_detail_aucune_donnee_sensible(h):
    termine = creer(h, debut_h=100, duree_h=60)
    pec = creer(h, debut_h=60, statut="prise_en_charge", agence="a2")
    corps = liste(h, h.cx_a).json()
    assert set(corps) == {"episodes", "curseur_suivant", "limite", "episodes_disponibles", "alertes_incluses"}
    for e in corps["episodes"]:
        assert set(e) == CHAMPS_LISTE, "la liste n'expose ni commentaire, ni identifiant d'utilisateur, ni organisation"
    d = detail(h, pec, h.am_a2).json()
    assert set(d) == CHAMPS_DETAIL
    assert "pris_en_charge_par_id" not in d and "organisation_id" not in d
    assert detail(h, termine, h.am_a1).status_code == 200


def test_le_detail_donne_toutes_les_dates_la_cause_de_fin_la_prise_en_charge_les_taux_et_les_seuils(h):
    eid = creer(h, debut_h=100, duree_h=60, statut=None, pris_en_charge_le=datetime.now(UTC) - timedelta(hours=95), pris_en_charge_par_nom="Awa Traoré",
                commentaire_prise_en_charge="Équipe prévenue", fin_cause="seuil_modifie", taux_ouverture=42.5, seuil_ouverture=70.0, taux_fermeture=66.0, seuil_fermeture=60.0)
    d = detail(h, eid, h.cx_a).json()
    assert d["statut"] == "terminee" and d["fin_cause"] == "seuil_modifie" and d["agence_nom"] == "Agence A1" and d["type"] == "seuil_satisfaction"
    assert d["taux_ouverture"] == 42.5 and d["seuil_ouverture"] == 70.0 and d["taux_fermeture"] == 66.0 and d["seuil_fermeture"] == 60.0
    assert d["detecte_le"] and d["debut_condition"] and d["fin_condition"] and d["terminee_le"] and d["created_at"] and d["pris_en_charge_le"]
    assert d["pris_en_charge_par_nom"] == "Awa Traoré" and d["commentaire_prise_en_charge"] == "Équipe prévenue"
    assert d["delai_prise_en_charge_minutes"] in (294, 295)                    # détecté à début + 5 min (il y a 100 h), pris en charge il y a 95 h
    for cle in ("detecte_le", "debut_condition", "fin_condition", "terminee_le", "pris_en_charge_le", "created_at"):
        assert datetime.fromisoformat(d[cle]).utcoffset() == timedelta(0), f"{cle} doit être en UTC avec fuseau"


def test_delai_de_prise_en_charge_entre_deux_instants_constates(h):
    eid = creer(h, debut_h=10, statut="prise_en_charge")           # détecté à début + 5 min, pris en charge à début + 35 min
    assert detail(h, eid, h.am_a1).json()["delai_prise_en_charge_minutes"] == 30
    sans = creer(h, agence="a2", debut_h=10)
    assert detail(h, sans, h.am_a2).json()["delai_prise_en_charge_minutes"] is None


def test_aucune_duree_n_est_certaine(h):
    ouvert = creer(h, debut_h=10)
    limite = creer(h, agence="a2", debut_h=720, debut_remontee_limitee=True)
    termine = creer(h, debut_h=300, duree_h=60)
    e = {x["episode_id"]: x for x in liste(h, h.am_a1).json()["episodes"]}
    assert e[str(ouvert)]["duree_en_cours"] is True and e[str(ouvert)]["duree_approximative"] is True and e[str(ouvert)]["duree_minimale"] is False
    assert 10 * 60 - 2 <= e[str(ouvert)]["duree_minutes"] <= 10 * 60 + 2
    assert e[str(termine)]["duree_en_cours"] is False and e[str(termine)]["duree_minutes"] == 60 * 60 and e[str(termine)]["duree_approximative"] is True
    l = {x["episode_id"]: x for x in liste(h, h.am_a2).json()["episodes"]}
    assert l[str(limite)]["duree_minimale"] is True and l[str(limite)]["debut_remontee_limitee"] is True and l[str(limite)]["duree_approximative"] is True
    assert 720 * 60 - 2 <= l[str(limite)]["duree_minutes"] <= 720 * 60 + 2


def test_duree_approximative_suit_le_debut_approximatif(h):
    eid = creer(h, debut_h=100, duree_h=60, debut_approximatif=False)
    assert detail(h, eid, h.am_a1).json()["duree_approximative"] is False
    assert detail(h, creer(h, agence="a2", debut_h=100, duree_h=60, debut_approximatif=True), h.am_a2).json()["duree_approximative"] is True


# ── Règle des 48 h du CX Manager ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_cx_ouvert_visible_a_partir_de_48h_l_agency_manager_voit_tout(h):
    court = creer(h, debut_h=47, agence="a1")
    long = creer(h, debut_h=49, agence="a2")
    assert identifiants(liste(h, h.cx_a)) == [str(long)]                      # 47 h : le CX n'aurait jamais vu l'alerte
    assert identifiants(liste(h, h.am_a1)) == [str(court)] and identifiants(liste(h, h.am_a2)) == [str(long)]   # l'AM la voit immédiatement
    assert detail(h, court, h.cx_a).status_code == 404 and detail(h, court, h.am_a1).status_code == 200
    assert detail(h, long, h.cx_a).status_code == 200


def test_cx_termine_visible_seulement_si_la_condition_a_dure_48h(h):
    court = creer(h, debut_h=300, duree_h=47)
    long = creer(h, debut_h=200, duree_h=49)
    assert identifiants(liste(h, h.cx_a)) == [str(long)]
    assert {*identifiants(liste(h, h.am_a1))} == {str(court), str(long)}
    assert detail(h, court, h.cx_a).status_code == 404 and detail(h, court, h.am_a1).status_code == 200


def test_cx_frontiere_exacte_de_48h_ouvert_et_termine(h):
    with h.Session() as s:
        cx, am = s.get(Utilisateur, h.cx_a), s.get(Utilisateur, h.am_a1)
        s.expunge_all()
    creer(h, debut_h=48, maintenant=T, agence="a1")                                   # ouvert depuis exactement 48 h : visible (comme l'alerte)
    creer(h, debut_h=500, duree_h=48, maintenant=T, agence="a2")                      # terminé après exactement 48 h : visible
    creer(h, debut_h=700, duree_h=47.99, maintenant=T, agence="a2")                   # 47 h 59 : invisible
    with h.Session() as s:
        cx_voit, _ = ep.lister_historique(s, cx, limite=100, maintenant=T)
        am_voit, _ = ep.lister_historique(s, am, limite=100, maintenant=T)
    assert sorted((e.statut, round((e.fin_condition - e.debut_condition).total_seconds() / 3600, 2) if e.fin_condition else None) for e, _ in cx_voit) == [("detectee", None), ("terminee", 48.0)]
    assert len(am_voit) == 1                                                          # l'AM n'a que A1 : l'épisode ouvert


def test_la_regle_des_48h_suit_exactement_l_alerte_du_cx_sur_de_vraies_donnees(h):
    """Même scénario, deux lectures : ce que le CX voit dans GET /alertes/ (alertes_seuil) et dans l'historique doit coïncider."""
    h.lire("am_a1")                                                                    # 4 mauvais avis récents (10 à 40 h) : épisode ouvert, mais < 48 h
    assert h.lire("cx_a")["alertes_seuil"] == [] and identifiants(liste(h, h.cx_a)) == []
    assert len(identifiants(liste(h, h.am_a1))) == 1
    for heures in (130, 120, 110, 100):                                                # avis plus anciens : sous le seuil depuis plus de 48 h
        h.ajouter("A1", 1, heures)
    # L'épisode ouvert garde son début déjà écrit (reconstitué à l'ouverture, ~40 h) : on le recrée comme le ferait une première lecture tardive.
    h.modifier(lambda s: s.query(AlerteEpisode).delete())
    h.lire("am_a1")
    assert len(h.lire("cx_a")["alertes_seuil"]) == 1 and len(identifiants(liste(h, h.cx_a))) == 1


def test_un_cx_ne_voit_pas_dans_l_historique_ce_que_sa_liste_d_alertes_ne_montre_pas_a_la_fin_de_l_episode(h):
    inconnu_du_cx = creer(h, debut_h=80, duree_h=10)
    assert detail(h, inconnu_du_cx, h.cx_a).status_code == 404 and liste(h, h.cx_a).json()["episodes"] == []
    assert detail(h, inconnu_du_cx, h.am_a1).status_code == 200


# ── Tri, pagination, filtres ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_tri_du_plus_recent_au_plus_ancien(h):
    plus_ancien = creer(h, debut_h=500, duree_h=60)
    milieu = creer(h, debut_h=300, duree_h=60)
    recent = creer(h, debut_h=100, duree_h=60)
    ouvert = creer(h, agence="a2", debut_h=60)
    assert identifiants(liste(h, h.cx_a)) == [str(ouvert), str(recent), str(milieu), str(plus_ancien)]


def test_pagination_par_curseur_parcourt_tout_sans_doublon_ni_oubli(h):
    attendus = [creer(h, debut_h=100 + 10 * i, duree_h=60) for i in range(7)]
    attendus_dans_l_ordre = [str(e) for e in attendus]                                  # du plus récent (i = 0) au plus ancien
    vus, curseur, pages = [], None, 0
    while True:
        params = {"limite": 3}
        if curseur:
            params["curseur"] = curseur
        corps = liste(h, h.am_a1, **params).json()
        vus += [e["episode_id"] for e in corps["episodes"]]
        pages += 1
        assert corps["limite"] == 3 and len(corps["episodes"]) <= 3
        curseur = corps["curseur_suivant"]
        if curseur is None:
            break
    assert vus == attendus_dans_l_ordre and pages == 3
    assert len(set(vus)) == len(vus)


def test_pagination_page_exacte_sans_page_vide_superflue(h):
    for i in range(4):
        creer(h, debut_h=100 + 10 * i, duree_h=60)
    corps = liste(h, h.am_a1, limite=4).json()
    assert len(corps["episodes"]) == 4 and corps["curseur_suivant"] is None


def test_pagination_debuts_identiques_departages_par_l_identifiant(h):
    debut = datetime.now(UTC) - timedelta(hours=100)
    for agence in ("a1", "a2"):
        for _ in range(2):
            creer(h, agence=agence, debut_h=100, duree_h=60, debut_condition=debut)
    vus, curseur = [], None
    for _ in range(10):
        params = {"limite": 1, **({"curseur": curseur} if curseur else {})}
        corps = liste(h, h.cx_a, **params).json()
        vus += [e["episode_id"] for e in corps["episodes"]]
        curseur = corps["curseur_suivant"]
        if curseur is None:
            break
    assert len(vus) == 4 and len(set(vus)) == 4, "aucun doublon ni oubli quand plusieurs épisodes ont le même début"


def test_bornes_de_pagination(h):
    creer(h, debut_h=100, duree_h=60)
    assert liste(h, h.am_a1, limite=0).status_code == 422
    assert liste(h, h.am_a1, limite=-1).status_code == 422
    assert liste(h, h.am_a1, limite=101).status_code == 422
    assert liste(h, h.am_a1, limite=100).status_code == 200 and liste(h, h.am_a1, limite=1).status_code == 200
    assert liste(h, h.am_a1, limite="abc").status_code == 422
    assert liste(h, h.am_a1).json()["limite"] == ep.LIMITE_PAGE_DEFAUT == 20 and ep.LIMITE_PAGE_MAX == 100


def test_la_limite_est_bornee_aussi_dans_le_service(h):
    for i in range(3):
        creer(h, debut_h=100 + 10 * i, duree_h=60)
    with h.Session() as s:
        am = s.get(Utilisateur, h.am_a1)
        lignes, _ = ep.lister_historique(s, am, limite=10 ** 9)
        assert len(lignes) == 3
        lignes, suivant = ep.lister_historique(s, am, limite=-5)
        assert len(lignes) == 1 and suivant is not None


def test_page_vide_et_curseur_invalide(h):
    vide = liste(h, h.am_a1)
    assert vide.status_code == 200 and vide.json()["episodes"] == [] and vide.json()["curseur_suivant"] is None
    for mauvais in ("n'importe-quoi", "####", "YWJj", "MjAyNi0wMS0wMXxub3RhdXVpZA", ep.encoder_curseur(datetime(2026, 1, 1, tzinfo=UTC), uuid4()).replace("A", "")[:10]):
        assert liste(h, h.am_a1, curseur=mauvais).status_code == 422, mauvais
    assert liste(h, h.am_a1, curseur="x" * 201).status_code == 422


def test_filtre_statut_simple_et_multiple(h):
    termine = creer(h, debut_h=300, duree_h=60)
    pec = creer(h, debut_h=200, statut="prise_en_charge")
    detectee = creer(h, agence="a2", debut_h=100)
    assert identifiants(liste(h, h.cx_a, statut="terminee")) == [str(termine)]
    assert identifiants(liste(h, h.cx_a, statut="detectee")) == [str(detectee)]
    assert identifiants(liste(h, h.cx_a, statut=["detectee", "prise_en_charge"])) == [str(detectee), str(pec)]       # « actifs »
    assert liste(h, h.cx_a, statut="n_importe_quoi").status_code == 422


def test_filtre_agence_et_periode(h):
    a1_ancien = creer(h, debut_h=400, duree_h=60)
    a1_recent = creer(h, debut_h=200, duree_h=60)
    a2 = creer(h, agence="a2", debut_h=300, duree_h=60)
    assert identifiants(liste(h, h.cx_a, agence_id=str(h.a2))) == [str(a2)]
    maintenant = datetime.now(UTC)
    du = (maintenant - timedelta(hours=350)).isoformat()
    au = (maintenant - timedelta(hours=250)).isoformat()
    assert identifiants(liste(h, h.cx_a, du=du)) == [str(a1_recent), str(a2)]
    assert identifiants(liste(h, h.cx_a, au=au)) == [str(a2), str(a1_ancien)]
    assert identifiants(liste(h, h.cx_a, du=du, au=au)) == [str(a2)]
    assert identifiants(liste(h, h.cx_a, du=du, au=au, agence_id=str(h.a1))) == []
    assert liste(h, h.cx_a, du=au, au=du).status_code == 422                          # du > au
    assert liste(h, h.cx_a, du="pas-une-date").status_code == 422
    sans_fuseau = (maintenant - timedelta(hours=350)).replace(tzinfo=None).isoformat()
    assert identifiants(liste(h, h.cx_a, du=sans_fuseau)) == [str(a1_recent), str(a2)], "sans fuseau : lu en UTC"


def test_les_filtres_ne_contournent_pas_la_regle_des_48h(h):
    creer(h, debut_h=20)
    assert liste(h, h.cx_a, statut="detectee").json()["episodes"] == []
    assert liste(h, h.cx_a, agence_id=str(h.a1)).json()["episodes"] == []
    assert len(liste(h, h.am_a1, statut="detectee").json()["episodes"]) == 1


def test_curseur_encode_decode():
    instant, identifiant = datetime(2026, 11, 3, 12, 0, 0, 123456, tzinfo=UTC), uuid4()
    assert ep.decoder_curseur(ep.encoder_curseur(instant, identifiant)) == (instant, identifiant)
    with pytest.raises(ep.CurseurInvalide):
        ep.decoder_curseur("")


# ── Lecture seule ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_lecture_seule_aucune_ecriture_aucune_reconciliation(h, monkeypatch):
    """A1 est sous son seuil (4 mauvais avis) mais n'a pas d'épisode ; A2 a un épisode ouvert alors qu'elle n'a aucun avis (la réconciliation le terminerait)."""
    ouvert_a2 = creer(h, agence="a2", debut_h=100)
    for nom in ("reconcilier_episodes", "_reconcilier"):
        monkeypatch.setattr(ep if nom == "_reconcilier" else alertes, nom, lambda *a, **k: (_ for _ in ()).throw(AssertionError("la réconciliation ne doit pas être appelée")))
    avant = len(h.ecritures)
    for acteur in (h.am_a1, h.am_a2, h.cx_a):
        assert liste(h, acteur).status_code == 200
        assert liste(h, acteur, statut="detectee", limite=5).status_code == 200
        assert detail(h, ouvert_a2, acteur).status_code in (200, 404)
    assert len(h.ecritures) == avant, h.ecritures[avant:]
    assert [e.statut for e in h.episodes()] == ["detectee"] and h.episodes()[0].id == ouvert_a2, "aucun épisode créé pour A1, celui de A2 n'est pas terminé"
    with h.Session() as s:
        assert s.query(JournalAudit).count() == 0


def test_la_lecture_de_l_historique_ne_change_pas_ce_que_fait_get_alertes(h):
    h.lire("am_a1")
    avant = [(e.id, e.statut, e.updated_at) for e in h.episodes()]
    reponse = h.lire("cx_a")
    for acteur in (h.am_a1, h.cx_a):
        liste(h, acteur)
    assert [(e.id, e.statut, e.updated_at) for e in h.episodes()] == avant
    assert h.lire("cx_a") == reponse


def test_les_methodes_d_ecriture_n_existent_pas_sur_les_nouvelles_routes(h):
    eid = creer(h, debut_h=100, duree_h=60)
    for methode in ("post", "put", "patch", "delete"):
        for chemin in ("/alertes/episodes", f"/alertes/episodes/{eid}"):
            assert getattr(h.client, methode)(chemin, headers=entete(h.am_a1)).status_code == 405, (methode, chemin)
