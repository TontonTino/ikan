"""
Épisodes d'alerte de seuil (PR 2/5) : logique pure de la réconciliation, puis écriture en silence à la lecture de GET /alertes/ (SQLite en mémoire).

La concurrence sur un vrai PostgreSQL, la migration et les contraintes de la base sont dans test_alertes_episodes_postgres.py.
Vrai routeur, vraie authentification JWT, deux organisations clientes. La réponse JSON de GET /alertes/ ne change jamais.
"""
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-episodes-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import alertes
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.alerte_episode import AlerteEpisode, STATUT_DETECTEE, STATUT_TERMINEE, TYPE_SEUIL_SATISFACTION
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.journal_audit import JournalAudit
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services import alertes_episodes as ep
from app.services import journal_audit as journal
from app.services.alertes_episodes import EpisodeOuvert, EtatAgence

UTC = timezone.utc
T = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)


# ── Logique pure ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def etat(taux, seuil=70.0, active=True, volume=5):
    return EtatAgence(agence_id=A1, organisation_id=ORG, nom="Agence", seuil=seuil, taux=taux, nombre_retours_clients=volume, active=active)


A1, ORG = uuid4(), uuid4()


def ouvert(seuil_ouverture=70.0):
    return EpisodeOuvert(id=uuid4(), agence_id=A1, seuil_ouverture=seuil_ouverture, debut_condition=T - timedelta(days=1))


def test_ouverture_quand_sous_le_seuil_et_pas_d_episode():
    plan = ep.planifier([etat(55.0)], [])
    assert [e.agence_id for e in plan.ouvertures] == [A1] and plan.fermetures == ()


@pytest.mark.parametrize("taux", [70.0, 82.5, None])
def test_pas_d_ouverture_au_seuil_au_dessus_ou_sans_assez_d_avis(taux):
    assert ep.planifier([etat(taux)], []).vide                    # « strictement sous » : pile au seuil n'est pas sous le seuil


def test_agence_desactivee_n_ouvre_pas():
    assert ep.planifier([etat(10.0, active=False)], []).vide


def test_maintien_tant_que_la_condition_est_vraie():
    assert ep.planifier([etat(55.0)], [ouvert()]).vide


@pytest.mark.parametrize("taux, seuil, seuil_ouv, attendue", [
    (75.0, 70.0, 70.0, "retablie"),                     # revenue au-dessus du seuil
    (70.0, 70.0, 70.0, "retablie"),                     # pile au seuil : plus sous le seuil
    (None, 70.0, 70.0, "donnees_insuffisantes"),        # la fenêtre s'est vidée : PAS une amélioration
    (60.0, 50.0, 70.0, "seuil_modifie"),                # encore sous le seuil d'ouverture : la règle a changé, pas la satisfaction
    (80.0, 50.0, 70.0, "retablie"),                     # seuil changé MAIS la satisfaction a vraiment remonté
])
def test_fin_et_cause(taux, seuil, seuil_ouv, attendue):
    plan = ep.planifier([etat(taux, seuil=seuil)], [ouvert(seuil_ouv)])
    assert [(c) for _, c, _ in plan.fermetures] == [attendue]
    assert plan.ouvertures == ()


def test_agence_desactivee_termine_l_episode():
    plan = ep.planifier([etat(10.0, active=False)], [ouvert()])
    assert [c for _, c, _ in plan.fermetures] == ["agence_desactivee"]


def test_donnees_insuffisantes_prime_sur_le_reste():
    assert ep.cause_de_fin(etat(None, seuil=50.0), ouvert(70.0)) == "donnees_insuffisantes"


def test_planification_idempotente_apres_application():
    """Après ouverture, l'épisode existe : la même situation ne produit plus rien. Après fin, idem."""
    assert ep.planifier([etat(55.0)], [ouvert()]).vide
    assert ep.planifier([etat(80.0)], []).vide


def avis(jours, note, heures=0):
    return (T - timedelta(days=jours) + timedelta(hours=heures), note)


def test_debut_reconstitue_premier_instant_de_la_serie_sous_le_seuil():
    # 3 bons avis il y a 6 jours, puis des mauvais : 75 % au 1er mauvais (pas sous 70), 60 % au 2e : le début est le 2e mauvais avis.
    liste = [avis(6, 5), avis(6, 5, 1), avis(6, 5, 2), avis(2, 1), avis(2, 1, 1), avis(2, 1, 2)]
    debut, limitee = ep.reconstituer_debut(liste, 70.0, T)
    assert debut == T - timedelta(days=2) + timedelta(hours=1) and limitee is False


def test_debut_borne_par_la_remontee_maximale():
    liste = [avis(40 - i, 1) for i in range(40)]            # mauvais depuis 40 jours, un par jour : sous le seuil depuis toujours
    debut, limitee = ep.reconstituer_debut(liste, 70.0, T)
    assert limitee is True and debut == T - ep.REMONTEE_DEBUT


def test_debut_jamais_dans_le_futur_et_jamais_avant_la_borne():
    liste = [avis(1, 1), avis(1, 1, 1), avis(1, 1, 2)]
    debut, _ = ep.reconstituer_debut(liste, 70.0, T)
    assert T - ep.REMONTEE_DEBUT <= debut <= T


def test_fin_reconstituee_premier_instant_ou_la_condition_cesse():
    liste = [avis(5, 1), avis(5, 1, 1), avis(5, 1, 2)] + [avis(2, 5, h) for h in range(8)]          # 7 bons sur 10 = 70,0 % (pas sous le seuil) dès le 7e
    debut = T - timedelta(days=5) + timedelta(hours=2)
    fin = ep.reconstituer_fin(liste, 70.0, debut, T)
    assert fin == T - timedelta(days=2) + timedelta(hours=6)                      # le premier instant où la condition cesse, pas « maintenant »
    assert ep.reconstituer_fin(liste[:3], 70.0, debut, T) == T      # jamais revenue au-dessus du seuil : « maintenant » à défaut


def test_interrupteur_valeurs(monkeypatch):
    for valeur, attendu in [("oui", True), ("", True), ("peut-etre", True), ("non", False), (" NON ", False), ("Non", False), ("false", False), ("0", False), ("off", False)]:
        monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", valeur)
        assert ep.reconciliation_activee() is attendu, valeur


# ── Intégration : GET /alertes/ écrit les épisodes en silence ─────────────────────────────────────────────────────────────────────────

@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)
    ecritures = []

    @event.listens_for(engine, "before_cursor_execute")
    def compter(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            ecritures.append(statement.split("(")[0].strip()[:60])

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(alertes.router, prefix="/alertes")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(UTC)
    org_a, org_b, org_admin = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_admin]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True) for c, ag in [("A1", a1), ("A2", a2), ("B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def ajouter_avis(code, note, heures):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=note, commentaire="TEXTE-SECRET-CLIENT", statut_traitement="nouveau",
                      date_soumission=now - timedelta(hours=heures))
        db.add(fb)
        return fb.id

    for code in ("A1", "B1"):                         # A1 et B1 sont sous leur seuil (4 mauvais avis récents) ; A2 n'a aucun avis
        for h in (40, 30, 20, 10):
            ajouter_avis(code, 1, h)

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    qr_ids = {c: q.id for c, q in qr.items()}
    ids = {k: v.id for k, v in dict(users, a1=a1, a2=a2, b1=b1, org_a=org_a, org_b=org_b).items()}
    db.close()

    def lire(acteur):
        r = client.get("/alertes/", headers={"Authorization": f"Bearer {create_access_token(ids[acteur])}"})
        assert r.status_code == 200, r.text
        return r.json()

    def episodes(**filtre):
        with Session() as s:
            requete = s.query(AlerteEpisode)
            for k, v in filtre.items():
                requete = requete.filter(getattr(AlerteEpisode, k) == v)
            lignes = requete.order_by(AlerteEpisode.detecte_le, AlerteEpisode.id).all()
            s.expunge_all()
            return lignes

    def modifier(fonction):
        with Session() as s:
            fonction(s)
            s.commit()

    client = TestClient(app)
    return SimpleNamespace(client=client, Session=Session, ids=ids, lire=lire, episodes=episodes, modifier=modifier, ecritures=ecritures,
                           ajouter=lambda code, note, heures: (modifier(lambda s: s.add(Feedback(
                               id=uuid4(), qr_code_id=qr_ids[code], note=note, statut_traitement="nouveau",
                               date_soumission=datetime.now(UTC) - timedelta(hours=heures)))), None)[1],
                           **ids)


def test_la_premiere_lecture_ouvre_un_episode_honnete(ctx):
    avant = datetime.now(UTC)
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    assert e.agence_id == ctx.a1 and e.organisation_id == ctx.org_a
    assert e.type == TYPE_SEUIL_SATISFACTION and e.statut == STATUT_DETECTEE
    detecte, debut = e.detecte_le.replace(tzinfo=UTC), e.debut_condition.replace(tzinfo=UTC)
    assert avant - timedelta(seconds=5) <= detecte <= datetime.now(UTC) + timedelta(seconds=5)      # detecte_le = maintenant (pas de passé fabriqué)
    assert debut < detecte - timedelta(hours=5), "le début est reconstitué d'après les avis, distinct de la date de détection"
    assert e.debut_approximatif is True and e.debut_remontee_limitee is False
    assert (e.taux_ouverture, e.seuil_ouverture, e.gravite_ouverture) == (0.0, 70.0, "critique")
    assert e.fin_condition is None and e.terminee_le is None and e.fin_cause is None and e.pris_en_charge_le is None


def test_la_reponse_de_get_alertes_est_identique_avec_et_sans_episodes(ctx, monkeypatch):
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "non")
    sans = {a: ctx.lire(a) for a in ("am_a1", "cx_a", "cx_b")}
    assert ctx.episodes() == []
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "oui")
    avec = {a: ctx.lire(a) for a in ("am_a1", "cx_a", "cx_b")}
    CHAMPS_EPISODE = {"episode_id", "episode_statut", "detecte_le", "debut_condition", "debut_approximatif", "debut_remontee_limitee", "pris_en_charge_le",
                      "pris_en_charge_par_nom", "commentaire_prise_en_charge"}      # champs ADDITIFS de la PR 3 (prise en charge) : tous None sans épisode

    def sans_champs_episode(reponse):
        return {**reponse, "alertes_seuil": [{k: v for k, v in a.items() if k not in CHAMPS_EPISODE} for a in reponse["alertes_seuil"]]}

    assert {a: sans_champs_episode(r) for a, r in avec.items()} == {a: sans_champs_episode(r) for a, r in sans.items()}      # anciens champs identiques
    assert all(a[k] is None for a in sans["am_a1"]["alertes_seuil"] for k in CHAMPS_EPISODE)                              # interrupteur coupé : champs None
    assert all(a["episode_id"] is not None and a["episode_statut"] == "detectee" for a in avec["am_a1"]["alertes_seuil"])
    assert len(ctx.episodes()) == 3 - 1                       # A1 et B1 (A2 n'a aucun avis) : la réponse n'a pas bougé, les épisodes existent
    assert set(avec["am_a1"]) == {"alertes_seuil", "alertes_feedback", "agences_sous_seuil", "alertes_incluses"}     # aucun champ de premier niveau ajouté


def test_idempotence_deux_lectures_aucun_changement_et_regime_stable_sans_ecriture(ctx):
    ctx.lire("cx_a")
    premier = [(e.id, e.statut, e.updated_at) for e in ctx.episodes()]
    ctx.ecritures.clear()
    for acteur in ("cx_a", "am_a1", "cx_a", "am_a1"):
        ctx.lire(acteur)
    assert [(e.id, e.statut, e.updated_at) for e in ctx.episodes()] == premier
    assert ctx.ecritures == [], f"écritures en régime stable : {ctx.ecritures}"         # ZÉRO écriture quand rien ne change


def test_portee_par_organisation_et_par_agence(ctx):
    ctx.lire("cx_a")
    assert {(e.agence_id, e.organisation_id) for e in ctx.episodes()} == {(ctx.a1, ctx.org_a)}      # jamais B1, jamais A2 (aucun avis)
    ctx.lire("am_b1")
    assert {(e.agence_id, e.organisation_id) for e in ctx.episodes()} == {(ctx.a1, ctx.org_a), (ctx.b1, ctx.org_b)}
    for e in ctx.episodes():
        with ctx.Session() as s:
            assert s.get(Agence, e.agence_id).organisation_id == e.organisation_id      # l'organisation de l'épisode est toujours celle de l'agence


def test_un_responsable_d_agence_ne_cree_que_l_episode_de_sa_propre_agence(ctx):
    ctx.lire("am_a1")
    assert {e.agence_id for e in ctx.episodes()} == {ctx.a1}


def test_un_cx_manager_ne_touche_jamais_les_episodes_d_une_autre_organisation(ctx):
    ctx.lire("am_b1")
    avant = [(e.id, e.statut) for e in ctx.episodes(organisation_id=ctx.org_b)]
    ctx.ajouter("A1", 5, 1)
    ctx.lire("cx_a")
    assert [(e.id, e.statut) for e in ctx.episodes(organisation_id=ctx.org_b)] == avant


def test_fin_retablie_quand_les_donnees_remontent_au_dessus_du_seuil(ctx):
    ctx.lire("am_a1")
    for i in range(12):
        ctx.ajouter("A1", 5, 1 + i * 0.01)
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    assert e.statut == STATUT_TERMINEE and e.fin_cause == "retablie"
    assert e.terminee_le is not None and e.fin_condition is not None
    assert e.fin_condition.replace(tzinfo=UTC) >= e.debut_condition.replace(tzinfo=UTC)
    assert e.taux_fermeture is not None and e.taux_fermeture >= 70.0


def test_fin_donnees_insuffisantes_quand_la_fenetre_se_vide(ctx):
    ctx.lire("am_a1")
    ctx.modifier(lambda s: s.query(Feedback).update({"date_soumission": datetime.now(UTC) - timedelta(days=20)}))
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    assert e.statut == STATUT_TERMINEE and e.fin_cause == "donnees_insuffisantes" and e.taux_fermeture is None


def test_fin_seuil_modifie_quand_la_regle_change_mais_pas_la_satisfaction(ctx):
    ctx.modifier(lambda s: s.query(Feedback).delete())
    for i, note in enumerate([5, 5, 5, 1, 1]):                          # 60 % : sous 70, au-dessus de 50
        ctx.ajouter("A1", note, 10 + i)
    ctx.lire("am_a1")
    assert [e.statut for e in ctx.episodes()] == [STATUT_DETECTEE]
    ctx.modifier(lambda s: s.query(Agence).filter(Agence.id == ctx.a1).update({"seuil_alerte": 50.0}))
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    assert e.statut == STATUT_TERMINEE and e.fin_cause == "seuil_modifie" and e.seuil_ouverture == 70.0 and e.seuil_fermeture == 50.0


def test_fin_agence_desactivee_vue_par_le_cx_manager(ctx):
    ctx.lire("cx_a")
    ctx.modifier(lambda s: s.query(Agence).filter(Agence.id == ctx.a1).update({"active": False}))
    ctx.lire("cx_a")
    (e,) = ctx.episodes()
    assert e.statut == STATUT_TERMINEE and e.fin_cause == "agence_desactivee"


def test_nouvel_episode_apres_une_fin_et_l_ancien_reste(ctx):
    ctx.lire("am_a1")
    premier = ctx.episodes()[0].id
    for i in range(12):
        ctx.ajouter("A1", 5, 1 + i * 0.01)
    ctx.lire("am_a1")
    assert ctx.episodes()[0].statut == STATUT_TERMINEE
    for i in range(40):
        ctx.ajouter("A1", 1, 0.5 + i * 0.001)                       # le problème revient
    ctx.lire("am_a1")
    episodes = ctx.episodes()
    assert len(episodes) == 2 and episodes[0].id == premier and episodes[0].statut == STATUT_TERMINEE
    assert episodes[1].id != premier and episodes[1].statut == STATUT_DETECTEE
    assert [e.statut for e in ctx.episodes() if e.statut != STATUT_TERMINEE] == [STATUT_DETECTEE]          # un seul épisode ouvert


def test_les_dates_sont_toutes_avec_fuseau_utc(ctx):
    ctx.lire("am_a1")
    for i in range(12):
        ctx.ajouter("A1", 5, 1 + i * 0.01)
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    for nom in ("debut_condition", "detecte_le", "fin_condition", "terminee_le", "created_at", "updated_at"):
        valeur = getattr(e, nom)
        assert valeur is not None
        assert valeur.tzinfo is None or valeur.utcoffset() == timedelta(0), nom          # SQLite renvoie des dates naïves : elles ont été écrites en UTC
    src = open(ep.__file__, encoding="utf8").read()
    assert "datetime.now()" not in src and "utcnow" not in src                    # jamais de datetime naïf dans le service


# ── Index unique partiel ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _episode(ctx, statut=STATUT_DETECTEE):
    fin = datetime.now(UTC)
    extra = dict(fin_condition=fin, terminee_le=fin, fin_cause="retablie") if statut == STATUT_TERMINEE else {}
    return AlerteEpisode(id=uuid4(), organisation_id=ctx.org_a, agence_id=ctx.a2, statut=statut, debut_condition=fin - timedelta(hours=1),
                         taux_ouverture=50.0, seuil_ouverture=70.0, **extra)


def test_index_unique_partiel_un_seul_episode_ouvert_par_agence_et_par_type(ctx):
    ctx.modifier(lambda s: s.add(_episode(ctx)))
    with pytest.raises(IntegrityError):
        ctx.modifier(lambda s: s.add(_episode(ctx)))
    ctx.modifier(lambda s: s.add(_episode(ctx, STATUT_TERMINEE)))                     # un épisode terminé n'est jamais gênant
    ctx.modifier(lambda s: s.add(_episode(ctx, STATUT_TERMINEE)))
    assert len(ctx.episodes(agence_id=ctx.a2)) == 3


# ── Journal d'audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _journal(ctx, action):
    with ctx.Session() as s:
        lignes = s.query(JournalAudit).filter(JournalAudit.action == action).all()
        s.expunge_all()
        return lignes


def test_journal_ouverture_et_fin_acteur_systeme_et_cles_qui_survivent_au_filtre(ctx):
    ctx.lire("am_a1")
    for i in range(12):
        ctx.ajouter("A1", 5, 1 + i * 0.01)
    ctx.lire("am_a1")
    (e,) = ctx.episodes()
    (ouverture,), (fin,) = _journal(ctx, journal.ALERTE_EPISODE_OUVERT), _journal(ctx, journal.ALERTE_EPISODE_TERMINE)
    for ligne in (ouverture, fin):
        assert ligne.acteur_role == "systeme" and ligne.acteur_id is None and ligne.resultat == "succes"
        assert ligne.cible_type == "alerte_episode" and ligne.cible_id == str(e.id) and ligne.organisation_id == ctx.org_a
        assert ligne.cible_libelle == "Agence A1"
    attendu_ouverture = {"agence_id", "type", "statut_apres", "debut_condition", "debut_approximatif", "debut_remontee_limitee", "taux", "seuil", "gravite",
                         "nombre_retours_clients"}
    attendu_fin = {"agence_id", "type", "statut_apres", "fin_cause", "fin_condition", "duree_minutes", "taux", "seuil"}
    assert set(ouverture.details) == attendu_ouverture, "une clé a été supprimée en silence par le filtre du journal"
    assert set(fin.details) == attendu_fin, "une clé a été supprimée en silence par le filtre du journal"
    assert ouverture.details["nombre_retours_clients"] == 4 and fin.details["fin_cause"] == "retablie"
    assert "TEXTE-SECRET-CLIENT" not in str([ouverture.details, fin.details])          # aucun texte d'avis dans le journal


def test_aucun_nom_de_cle_du_journal_ne_contient_un_fragment_interdit():
    cles = {"agence_id", "type", "statut_apres", "debut_condition", "debut_approximatif", "debut_remontee_limitee", "taux", "seuil", "gravite",
            "nombre_retours_clients", "fin_cause", "fin_condition", "duree_minutes"}
    for cle in cles:
        assert not any(f in cle.lower() for f in journal.FRAGMENTS_INTERDITS), cle
    assert journal.assainir_details({c: 1 for c in cles}).keys() == cles
    assert "nb_avis" not in journal.assainir_details({"nb_avis": 4, "taux": 1})              # rappel du piège : cette clé-là disparaît


def test_un_episode_deja_ouvert_n_ecrit_rien_dans_le_journal(ctx):
    ctx.lire("am_a1")
    ctx.lire("am_a1")
    ctx.lire("cx_a")
    assert len(_journal(ctx, journal.ALERTE_EPISODE_OUVERT)) == 1 and _journal(ctx, journal.ALERTE_EPISODE_TERMINE) == []


# ── Interrupteur d'urgence ────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("valeur", ["non", "NON", " non ", "false"])
def test_interrupteur_coupe_toute_la_reconciliation(ctx, monkeypatch, valeur):
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", valeur)
    ctx.ecritures.clear()
    ctx.lire("am_a1"); ctx.lire("cx_a")
    assert ctx.episodes() == [] and ctx.ecritures == [] and _journal(ctx, journal.ALERTE_EPISODE_OUVERT) == []
    assert ep.reconcilier_episodes(None, None) is None                      # n'ouvre même pas de session


def test_interrupteur_actif_par_defaut():
    assert ep.settings.ALERTES_EPISODES == "oui" and ep.reconciliation_activee()


def test_reactiver_l_interrupteur_reprend_sans_passe_fabrique(ctx, monkeypatch):
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "non")
    ctx.lire("am_a1")
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "oui")
    ctx.lire("am_a1")
    assert len(ctx.episodes()) == 1


# ── Panne : la lecture ne casse JAMAIS ────────────────────────────────────────────────────────────────────────────────────────────────

def test_panne_d_ecriture_la_reponse_est_exactement_la_meme(ctx, monkeypatch, caplog):
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "non")
    attendu = {a: ctx.lire(a) for a in ("am_a1", "cx_a")}

    def panne(*a, **k):
        raise RuntimeError("PANNE-SECRETE postgres://utilisateur:motdepasse@hote/base")

    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "oui")
    monkeypatch.setattr(ep, "_inserer_si_absent", panne)
    with caplog.at_level(logging.ERROR, logger="ikan.alertes_episodes"):
        obtenu = {a: ctx.lire(a) for a in ("am_a1", "cx_a")}
    assert obtenu == attendu
    assert ctx.episodes() == []
    assert "RuntimeError" in caplog.text and "PANNE-SECRETE" not in caplog.text and "motdepasse" not in caplog.text      # le type seul, jamais le contenu


def test_panne_apres_ecriture_la_transaction_est_annulee(ctx, monkeypatch):
    def panne_journal(*a, **k):
        raise RuntimeError("journal indisponible")

    monkeypatch.setattr(ep.journal, "journaliser", panne_journal)
    assert ctx.lire("am_a1")["alertes_seuil"]                                # la lecture réussit toujours
    assert ctx.episodes() == [], "l'épisode inséré avant la panne doit être annulé avec sa transaction"


def test_panne_de_la_table_absente_ne_casse_pas_la_lecture(ctx):
    ctx.modifier(lambda s: s.execute(__import__("sqlalchemy").text("DROP TABLE alerte_episodes")))
    assert ctx.lire("am_a1")["alertes_seuil"]


def test_reconcilier_ne_leve_jamais(monkeypatch):
    monkeypatch.setattr(ep, "_reconcilier", lambda *a, **k: (_ for _ in ()).throw(ValueError("x")))
    db = SimpleNamespace(get_bind=lambda: create_engine("sqlite+pysqlite://"))
    assert ep.reconcilier_episodes(db, SimpleNamespace(role=UserRole.CX_MANAGER, organisation_id=uuid4())) is None


# ── Périmètres de rôle inchangés ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_admin_refuse_et_aucun_episode_cree(ctx):
    r = ctx.client.get("/alertes/", headers={"Authorization": f"Bearer {create_access_token(ctx.admin)}"})
    assert r.status_code == 403 and ctx.episodes() == []
    assert ctx.client.get("/alertes/").status_code in {401, 403} and ctx.episodes() == []


def test_forfait_sans_alertes_aucun_episode(ctx, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: False)
    assert ctx.lire("am_a1")["alertes_incluses"] is False
    assert ctx.episodes() == []
