"""
Protection du formulaire public (audit Client Final) : limitation de débit, champ piège, tailles, endpoints publics en
lecture seule, agence désactivée, réponse minimale, consentement, journaux.

Base SQLite en mémoire, même pattern que test_parcours_client_qr.py ; l'application est montée AVEC le plafond de corps
(LimiteCorpsPublic) et les préfixes réels (/api/v1/...), car le plafond et les dépendances de limitation en dépendent.
"""
import logging
import os
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-protection-formulaire-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.v1.endpoints import feedbacks, qr_codes
from app.core import rate_limit
from app.core.body_limit import LimiteCorpsPublic
from app.core.config import settings
from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.suggestion import Suggestion
from app.models.system_settings import SystemSettings
from app.models.utilisateur import Utilisateur
from app.utils.masquage import masquer_contacts

TABLES = [Organisation.__table__, Agence.__table__, Utilisateur.__table__, QRCode.__table__, Categorie.__table__,
          Feedback.__table__, HistoriqueFeedback.__table__, DemandeContact.__table__, AnalyseIA.__table__,
          Suggestion.__table__, SystemSettings.__table__]

TELEPHONE = "+226 70 12 34 56"
FEEDBACKS = "/api/v1/feedbacks/"


@pytest.fixture()
def ctx(monkeypatch):
    analyses = []
    monkeypatch.setattr(feedbacks, "analyser_feedback", lambda feedback_id, db: analyses.append(feedback_id))

    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    db = Session()

    org = Organisation(id=uuid4(), nom="Org", active=True)
    db.add(org)
    db.flush()

    def creer_agence(nom, code_qr, *, active=True, qr_actif=True, avec_qr=True, avec_categorie=True):
        agence = Agence(id=uuid4(), organisation_id=org.id, nom=nom, active=active)
        db.add(agence)
        db.flush()
        qr_id = None
        if avec_qr:
            qr = QRCode(id=uuid4(), agence_id=agence.id, code=code_qr, url=f"http://test/{code_qr}", actif=qr_actif)
            db.add(qr)
            qr_id = qr.id
        cat_id = None
        if avec_categorie:
            cat = Categorie(id=uuid4(), agence_id=agence.id, nom=f"Cat {nom}", active=True)
            db.add(cat)
            cat_id = cat.id
        db.flush()
        return SimpleNamespace(agence=agence.id, qr=qr_id, categorie=cat_id, code=code_qr)

    ids = SimpleNamespace(
        a=creer_agence("Agence A", "QR-A"),
        b=creer_agence("Agence B", "QR-B"),
        desactivee=creer_agence("Agence Fermee", "QR-FERMEE", active=False),  # agence off, QR encore actif
        sans_qr=creer_agence("Agence Sans QR", "QR-X", avec_qr=False),
        sans_categorie=creer_agence("Agence Sans Categorie", "QR-SC", avec_categorie=False),
    )
    db.commit()
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.add_middleware(LimiteCorpsPublic)
    app.include_router(feedbacks.router, prefix="/api/v1/feedbacks")
    app.include_router(qr_codes.router, prefix="/api/v1/qr-codes")
    app.dependency_overrides[get_db] = _db

    def lignes():
        with engine.connect() as conn:
            return {t.name: conn.execute(select(func.count()).select_from(t)).scalar() for t in TABLES}

    return SimpleNamespace(client=TestClient(app), ids=ids, Session=Session, analyses=analyses, lignes=lignes)


def envoyer(ctx, agence=None, *, code=None, entetes=None, **extra):
    agence = agence or ctx.ids.a
    corps = {"categorie_id": str(agence.categorie), "note": 4, **extra}
    return ctx.client.post(FEEDBACKS, params={"qr_code": code or agence.code}, json=corps, headers=entetes or {})


def limites(monkeypatch, *, ip=0, qr=0, public=0, sauts=0):
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_IP", ip)
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_QR", qr)
    monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_PAR_IP", public)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", sauts)


# ───────────────────────── limitation de débit ─────────────────────────

def test_au_dela_du_seuil_par_ip_l_envoi_est_refuse_en_429_et_rien_n_est_cree(ctx, monkeypatch):
    limites(monkeypatch, ip=3)
    for _ in range(3):
        assert envoyer(ctx).status_code == 201
    avant = ctx.lignes()
    r = envoyer(ctx)
    assert r.status_code == 429
    assert "Trop de demandes" in r.json()["detail"] and "réessayer" in r.json()["detail"]
    assert int(r.headers["Retry-After"]) >= 1
    assert ctx.lignes() == avant                      # ni feedback, ni historique, ni contact
    assert len(ctx.analyses) == 3                     # ni analyse IA (donc aucune consommation de quota) pour l'envoi refusé


def test_un_envoi_refuse_par_le_limiteur_n_atteint_meme_pas_la_base(ctx, monkeypatch):
    """Même un code QR inexistant ou un corps invalide compte : le refus 429 passe avant toute lecture en base."""
    limites(monkeypatch, ip=1)
    assert envoyer(ctx, code="QR-INCONNU").status_code == 404
    assert envoyer(ctx).status_code == 429


def test_au_dela_du_seuil_par_qr_meme_depuis_des_ip_differentes(ctx, monkeypatch):
    limites(monkeypatch, qr=2, sauts=1)
    assert envoyer(ctx, entetes={"X-Forwarded-For": "10.0.0.1"}).status_code == 201
    assert envoyer(ctx, entetes={"X-Forwarded-For": "10.0.0.2"}).status_code == 201
    assert envoyer(ctx, entetes={"X-Forwarded-For": "10.0.0.3"}).status_code == 429
    assert envoyer(ctx, ctx.ids.b, entetes={"X-Forwarded-For": "10.0.0.3"}).status_code == 201  # un autre QR n'est pas touché


def test_x_forwarded_for_est_ignore_sans_proxy_de_confiance(ctx, monkeypatch):
    limites(monkeypatch, ip=2, sauts=0)
    assert envoyer(ctx, entetes={"X-Forwarded-For": "1.1.1.1"}).status_code == 201
    assert envoyer(ctx, entetes={"X-Forwarded-For": "2.2.2.2"}).status_code == 201
    assert envoyer(ctx, entetes={"X-Forwarded-For": "3.3.3.3"}).status_code == 429  # l'usurpation ne contourne rien


def test_derriere_un_proxy_seule_l_entree_posee_par_le_proxy_compte(ctx, monkeypatch):
    limites(monkeypatch, ip=1, sauts=1)
    # Le client prétend être 1.1.1.1, 2.2.2.2... mais le proxy (dernière entrée) voit toujours 9.9.9.9.
    assert envoyer(ctx, entetes={"X-Forwarded-For": "1.1.1.1, 9.9.9.9"}).status_code == 201
    assert envoyer(ctx, entetes={"X-Forwarded-For": "2.2.2.2, 9.9.9.9"}).status_code == 429
    assert envoyer(ctx, entetes={"X-Forwarded-For": "2.2.2.2, 8.8.8.8"}).status_code == 201


def test_secret_ssr_permet_de_transmettre_l_ip_du_visiteur(ctx, monkeypatch):
    limites(monkeypatch, public=1)
    monkeypatch.setattr(settings, "SSR_FORWARD_SECRET", "secret-partage")
    bon = {"X-Ikan-Ssr-Secret": "secret-partage"}
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate", headers={**bon, "X-Ikan-Client-Ip": "5.5.5.5"}).status_code == 200
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate", headers={**bon, "X-Ikan-Client-Ip": "6.6.6.6"}).status_code == 200
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate", headers={**bon, "X-Ikan-Client-Ip": "5.5.5.5"}).status_code == 429
    # Mauvais secret : l'adresse transmise est ignorée (le socket fait foi), donc compte pour une même IP.
    mauvais = {"X-Ikan-Ssr-Secret": "faux"}
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate", headers={**mauvais, "X-Ikan-Client-Ip": "7.7.7.7"}).status_code == 200
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate", headers={**mauvais, "X-Ikan-Client-Ip": "8.8.8.8"}).status_code == 429


@pytest.mark.parametrize("chemin", ["/api/v1/qr-codes/QR-A/validate", "/api/v1/qr-codes/QR-A/categories"])
def test_les_lectures_publiques_sont_limitees_par_ip(ctx, monkeypatch, chemin):
    limites(monkeypatch, public=3)
    assert [ctx.client.get(chemin).status_code for _ in range(3)] == [200, 200, 200]
    r = ctx.client.get(chemin)
    assert r.status_code == 429 and "Trop de demandes" in r.json()["detail"]


def test_le_nps_est_limite_par_ip(ctx, monkeypatch):
    limites(monkeypatch, public=2)
    corps = {"nps_note": 5, "token": "invalide"}
    chemin = f"/api/v1/feedbacks/{uuid4()}/nps"
    assert ctx.client.post(chemin, json=corps).status_code == 403
    assert ctx.client.post(chemin, json=corps).status_code == 403
    assert ctx.client.post(chemin, json=corps).status_code == 429


def test_le_limiteur_libere_apres_la_fenetre():
    horloge = {"t": 0.0}
    lim = rate_limit.LimiteurFenetre(fenetre_s=60, horloge=lambda: horloge["t"])
    assert [lim.tenter("k", 2)[0] for _ in range(3)] == [True, True, False]
    horloge["t"] = 61.0
    assert lim.tenter("k", 2)[0] is True


def test_le_limiteur_borne_sa_memoire(monkeypatch):
    monkeypatch.setattr(rate_limit, "MAX_CLES_SUIVIES", 50)
    lim = rate_limit.LimiteurFenetre()
    for i in range(500):
        lim.tenter(f"code-{i}", 5)
    assert len(lim._evenements) <= 50


# ───────────────────────── champ piège ─────────────────────────

def test_champ_piege_rempli_repond_comme_un_succes_sans_rien_enregistrer(ctx):
    avant = ctx.lignes()
    r = envoyer(ctx, website="http://spam.example")
    assert r.status_code == 201
    assert set(r.json()) == {"id", "nps_token", "message"}
    assert ctx.lignes() == avant
    assert ctx.analyses == []


def test_champ_piege_vide_ou_absent_n_empeche_pas_l_envoi(ctx):
    assert envoyer(ctx, website="").status_code == 201
    assert envoyer(ctx).status_code == 201
    assert ctx.lignes()["feedbacks"] == 2


# ───────────────────────── tailles ─────────────────────────

@pytest.mark.parametrize("champ,valeur", [
    ("suggestion", "x" * 1001),
    ("commentaire", "x" * 1001),
    ("contact_nom", "n" * 101),
    ("contact_email", "a" * 250 + "@b.fr"),
])
def test_champs_trop_longs_refuses_sans_rien_creer(ctx, champ, valeur):
    r = envoyer(ctx, **{champ: valeur})
    assert r.status_code == 422
    assert ctx.lignes()["feedbacks"] == 0


def test_limites_exactes_acceptees(ctx):
    r = envoyer(ctx, suggestion="s" * 1000, commentaire="c" * 1000, contact_nom="n" * 100,
                contact_email="a" * 240 + "@exemple.fr")
    assert r.status_code == 201, r.text


@pytest.mark.parametrize("email", ["pas-un-email", "a@b", "a b@c.fr", "@c.fr", "a@@c.fr"])
def test_email_invalide_refuse(ctx, email):
    r = envoyer(ctx, contact_email=email)
    assert r.status_code == 422 and "e-mail invalide" in r.text
    assert ctx.lignes()["feedbacks"] == 0


def test_corps_trop_volumineux_refuse_en_413_avant_toute_lecture(ctx):
    avant = ctx.lignes()
    r = ctx.client.post(FEEDBACKS, params={"qr_code": "QR-A"},
                        content=b'{"categorie_id": "' + b"x" * (settings.PUBLIC_BODY_MAX_OCTETS + 10) + b'"}',
                        headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and "trop volumineux" in r.json()["detail"]
    assert ctx.lignes() == avant


def test_corps_fragmente_trop_volumineux_refuse_aussi(ctx):
    def morceaux():
        for _ in range(10):
            yield b"x" * (settings.PUBLIC_BODY_MAX_OCTETS // 4)
    r = ctx.client.post(FEEDBACKS, params={"qr_code": "QR-A"}, content=morceaux(),
                        headers={"Content-Type": "application/json"})
    assert r.status_code == 413


# ───────────────────────── endpoints publics en lecture seule ─────────────────────────

@pytest.mark.parametrize("code", ["QR-A", "QR-X", "QR-SC", "QR-FERMEE", "QR-INCONNU"])
def test_validate_et_categories_n_ecrivent_jamais_en_base(ctx, code):
    avant = ctx.lignes()
    for suffixe in ("validate", "categories"):
        ctx.client.get(f"/api/v1/qr-codes/{code}/{suffixe}")
    assert ctx.lignes() == avant


def test_uuid_d_une_agence_sans_qr_repond_404_et_ne_cree_pas_de_qr(ctx):
    avant = ctx.lignes()
    for suffixe in ("validate", "categories"):
        assert ctx.client.get(f"/api/v1/qr-codes/{ctx.ids.sans_qr.agence}/{suffixe}").status_code == 404
    assert ctx.lignes() == avant


def test_agence_sans_categorie_renvoie_une_liste_vide_sans_creer_general(ctx):
    avant = ctx.lignes()
    r = ctx.client.get("/api/v1/qr-codes/QR-SC/categories")
    assert r.status_code == 200 and r.json() == []
    assert ctx.lignes() == avant


def test_validate_renvoie_la_duree_de_conservation_configuree_sans_ecrire(ctx):
    r = ctx.client.get("/api/v1/qr-codes/QR-A/validate")
    assert r.status_code == 200 and r.json()["retention_mois"] == 24  # défaut : aucune ligne de configuration
    assert ctx.lignes()["system_settings"] == 0
    db = ctx.Session()
    db.add(SystemSettings(retention_mois=12))
    db.commit()
    db.close()
    assert ctx.client.get("/api/v1/qr-codes/QR-A/validate").json()["retention_mois"] == 12


# ───────────────────────── agence désactivée ─────────────────────────

def test_qr_actif_d_une_agence_desactivee_repond_404_par_code_et_par_uuid(ctx):
    ferme = ctx.ids.desactivee
    for identifiant in (ferme.code, str(ferme.agence)):
        for suffixe in ("validate", "categories"):
            assert ctx.client.get(f"/api/v1/qr-codes/{identifiant}/{suffixe}").status_code == 404, (identifiant, suffixe)
        avant = ctx.lignes()
        assert envoyer(ctx, ferme, code=identifiant).status_code == 404
        assert ctx.lignes() == avant


def test_une_agence_active_reste_joignable_par_code_et_par_uuid(ctx):
    a = ctx.ids.a
    assert ctx.client.get(f"/api/v1/qr-codes/{a.code}/validate").status_code == 200
    assert ctx.client.get(f"/api/v1/qr-codes/{a.agence}/validate").status_code == 200
    assert envoyer(ctx, a, code=str(a.agence)).status_code == 201


# ───────────────────────── réponse publique minimale ─────────────────────────

def test_la_reponse_publique_ne_contient_que_id_nps_token_et_message(ctx):
    r = envoyer(ctx, commentaire="Très bien")
    assert r.status_code == 201
    corps = r.json()
    assert set(corps) == {"id", "nps_token", "message"}
    assert corps["nps_token"] and "enregistré" in corps["message"]
    assert "Très bien" not in r.text and str(ctx.ids.a.agence) not in r.text


def test_le_renvoi_idempotent_a_la_meme_reponse_minimale(ctx):
    cle = "cle-idempotence-0001"
    premier = envoyer(ctx, idempotency_key=cle)
    second = envoyer(ctx, idempotency_key=cle)
    assert (premier.status_code, second.status_code) == (201, 200)
    assert set(second.json()) == {"id", "nps_token", "message"} and second.json()["id"] == premier.json()["id"]
    assert ctx.lignes()["feedbacks"] == 1


# ───────────────────────── consentement ─────────────────────────

def test_telephone_sans_consentement_refuse_et_rien_n_est_cree(ctx):
    avant = ctx.lignes()
    r = envoyer(ctx, souhaite_etre_rappele=True, contact_telephone=TELEPHONE)
    assert r.status_code == 422 and "accepter" in r.text
    r = envoyer(ctx, souhaite_etre_rappele=True, contact_telephone=TELEPHONE, consentement_contact=False)
    assert r.status_code == 422
    assert ctx.lignes() == avant


def test_telephone_avec_consentement_enregistre_le_consentement_sa_date_et_la_duree(ctx):
    db = ctx.Session()
    db.add(SystemSettings(retention_mois=18))
    db.commit()
    db.close()
    r = envoyer(ctx, souhaite_etre_rappele=True, contact_telephone=TELEPHONE, consentement_contact=True)
    assert r.status_code == 201, r.text
    db = ctx.Session()
    dc = db.query(DemandeContact).one()
    assert dc.telephone == TELEPHONE
    assert dc.consentement_contact is True
    assert isinstance(dc.consentement_date, datetime)
    assert dc.consentement_retention_mois == 18       # lue dans la configuration, pas fournie par le client
    db.close()


def test_la_duree_de_conservation_envoyee_par_le_client_est_ignoree(ctx):
    r = envoyer(ctx, souhaite_etre_rappele=True, contact_telephone=TELEPHONE, consentement_contact=True,
                consentement_retention_mois=1)
    assert r.status_code == 201
    db = ctx.Session()
    assert db.query(DemandeContact).one().consentement_retention_mois == 24
    db.close()


def test_sans_telephone_le_consentement_n_est_pas_exige(ctx):
    assert envoyer(ctx).status_code == 201
    assert envoyer(ctx, souhaite_etre_rappele=False, contact_telephone="  ").status_code == 201


# ───────────────────────── journaux ─────────────────────────

def test_une_erreur_a_l_enregistrement_ne_journalise_ni_exception_ni_coordonnees(ctx, monkeypatch, caplog):
    def explose(*args, **kwargs):
        raise RuntimeError("INSERT demandes_contact (+22670123456, jean@exemple.fr) a échoué")

    monkeypatch.setattr(feedbacks, "HistoriqueFeedback", explose)
    with caplog.at_level(logging.DEBUG):
        r = envoyer(ctx, souhaite_etre_rappele=True, contact_telephone=TELEPHONE, consentement_contact=True,
                    contact_email="jean@exemple.fr")
    assert r.status_code == 500
    journal = caplog.text
    assert "submit_feedback" in journal
    for secret in ("22670123456", "70 12 34 56", "jean@exemple.fr", "INSERT", "échoué"):
        assert secret not in journal, secret
    assert all(rec.exc_info is None for rec in caplog.records)


def test_masquage_des_telephones_et_emails():
    texte = "Appeler +226 70 12 34 56 ou 0022670123456 ou jean.dupont@exemple.fr tout de suite"
    masque = masquer_contacts(texte)
    assert "70 12 34 56" not in masque and "0022670123456" not in masque and "jean.dupont" not in masque
    assert "[téléphone masqué]" in masque and "[e-mail masqué]" in masque
    assert masquer_contacts(None) == "" and masquer_contacts("note 4 sur 5") == "note 4 sur 5"
