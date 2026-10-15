"""
PR A — intégrité des entrées côté CX / administration : seuil d'alerte borné, mot de passe d'un compte, unicité de l'e-mail
(création ET modification), responsable d'agence toujours rattaché à une agence.

Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée de test_isolation_multi_org : deux organisations A et B). Pour chaque
refus, l'état en base est relu : rien n'a été écrit.
"""
import json
import logging
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints import auth as auth_endpoints
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import verify_password
from app.models.agence import Agence
from app.models.utilisateur import Utilisateur
from app.schemas.auth import ChangerMotDePasseRequest
from app.schemas.mot_de_passe import MESSAGE_EGAL_EMAIL, MESSAGE_TROP_COURT, verifier_mot_de_passe
from tests.test_isolation_multi_org import ctx  # noqa: F401  (fixture réutilisée)

MOT_DE_PASSE_SECRET = "Secr3t-Valeur-Distinctive"


@pytest.fixture(autouse=True)
def _erreurs_sans_echo(ctx):  # noqa: F811
    installer_erreurs_validation(ctx.client.app)


def _envoyer(ctx, methode, url, acteur, corps):
    """Envoie `corps` tel quel (texte JSON brut : permet NaN et Infinity, que `json=` n'enverrait pas)."""
    brut = corps if isinstance(corps, (str, bytes)) else json.dumps(corps)
    return ctx.client.request(methode, url, headers={**ctx.H(acteur), "Content-Type": "application/json"}, content=brut)


def _detail(reponse):
    corps = reponse.json()["detail"]
    return corps if isinstance(corps, str) else " | ".join(e["msg"] for e in corps)


def _seuil_en_base(ctx, agence_id):
    db = ctx.Session()
    try:
        return db.get(Agence, agence_id).seuil_alerte
    finally:
        db.close()


def _nb(ctx, modele):
    db = ctx.Session()
    try:
        return db.query(modele).count()
    finally:
        db.close()


def _email_de(ctx, user_id):
    db = ctx.Session()
    try:
        return db.get(Utilisateur, user_id).email
    finally:
        db.close()


# ═════════════════════════ 1. Seuil d'alerte ═════════════════════════

def _seuil_alertes(ctx, brut):
    return _envoyer(ctx, "PATCH", f"/alertes/agences/{ctx.a1}/seuil", ctx.cx_a, '{"seuil_alerte": %s}' % brut)


def _seuil_agence_patch(ctx, brut):
    return _envoyer(ctx, "PATCH", f"/agences/{ctx.a1}", ctx.cx_a, '{"seuil_alerte": %s}' % brut)


def _seuil_agence_creation(ctx, brut):
    return _envoyer(ctx, "POST", "/agences/", ctx.cx_a, '{"nom": "Nouvelle agence", "seuil_alerte": %s}' % brut)


MODES = [("alertes", _seuil_alertes), ("agence-patch", _seuil_agence_patch), ("agence-creation", _seuil_agence_creation)]
VALIDES = [("0", 0.0), ("0.0", 0.0), ("100", 100.0), ("100.0", 100.0), ("55.5", 55.5), ("1", 1.0)]
INVALIDES = ["-0.1", "100.1", "-1", "101", "NaN", "Infinity", "-Infinity", '"abc"', '"70"', '""', "null", "true", "[]", "{}", "1e999"]


@pytest.mark.parametrize("nom,envoi", MODES)
@pytest.mark.parametrize("brut,attendu", VALIDES)
def test_seuil_aux_bornes_et_valeurs_valides_est_enregistre(ctx, nom, envoi, brut, attendu):
    avant_agences = _nb(ctx, Agence)
    r = envoi(ctx, brut)
    assert r.status_code in (200, 201), (nom, brut, r.text)
    if nom == "agence-creation":
        assert _nb(ctx, Agence) == avant_agences + 1 and r.json()["seuil_alerte"] == attendu
    else:
        assert _seuil_en_base(ctx, ctx.a1) == attendu


@pytest.mark.parametrize("nom,envoi", MODES)
@pytest.mark.parametrize("brut", INVALIDES)
def test_seuil_hors_bornes_ou_non_numerique_est_refuse_sans_rien_ecrire(ctx, nom, envoi, brut):
    avant_seuil, avant_agences = _seuil_en_base(ctx, ctx.a1), _nb(ctx, Agence)
    r = envoi(ctx, brut)
    assert r.status_code == 422, (nom, brut, r.text)
    assert "entre 0 et 100" in _detail(r)                               # message clair, en français
    assert "input" not in r.text
    assert _seuil_en_base(ctx, ctx.a1) == avant_seuil == 70             # valeur en base inchangée
    assert _nb(ctx, Agence) == avant_agences                            # aucune agence créée par un refus


def test_seuil_absent(ctx):
    # Route dédiée : le seuil est obligatoire (message français) ; modification d'agence : absent = inchangé ; création : défaut 80.
    r = _envoyer(ctx, "PATCH", f"/alertes/agences/{ctx.a1}/seuil", ctx.cx_a, "{}")
    assert r.status_code == 422 and "obligatoire" in _detail(r) and _seuil_en_base(ctx, ctx.a1) == 70
    ok = _envoyer(ctx, "PATCH", f"/agences/{ctx.a1}", ctx.cx_a, {"ville": "Lyon 2e"})
    assert ok.status_code == 200 and _seuil_en_base(ctx, ctx.a1) == 70
    cree = _envoyer(ctx, "POST", "/agences/", ctx.cx_a, {"nom": "Sans seuil"})
    assert cree.status_code == 201 and cree.json()["seuil_alerte"] == 80


def test_le_cx_etranger_reste_refuse_et_le_seuil_inchange(ctx):
    r = _envoyer(ctx, "PATCH", f"/alertes/agences/{ctx.b1}/seuil", ctx.cx_a, '{"seuil_alerte": 10}')
    assert r.status_code == 403 and _seuil_en_base(ctx, ctx.b1) == 70


# ═════════════════════════ 2. Mot de passe ═════════════════════════

def _corps_am(ctx, **extra):
    base = {"nom": "Nouveau", "prenom": "AM", "email": f"{uuid4().hex[:10]}@test.io", "password": "Motdepasse-123",
            "role": "agency_manager", "agence_id": str(ctx.a1)}
    base.update(extra)
    return base


def _creer(ctx, acteur=None, **extra):
    return _envoyer(ctx, "POST", "/utilisateurs/", acteur or ctx.cx_a, _corps_am(ctx, **extra))


def _modifier(ctx, user_id, corps, acteur=None):
    return _envoyer(ctx, "PATCH", f"/utilisateurs/{user_id}", acteur or ctx.cx_a, corps)


def test_validateur_unique_messages_et_regles():
    assert verifier_mot_de_passe("12345678") == "12345678"                       # 8 caractères : accepté (borne)
    with pytest.raises(ValueError, match="au moins 8 caractères"):
        verifier_mot_de_passe("1234567")                                          # 7 : refusé (borne)
    with pytest.raises(ValueError) as e:
        verifier_mot_de_passe(" Awa@Test.IO ", "awa@test.io")
    assert str(e.value) == MESSAGE_EGAL_EMAIL                                     # casse et espaces ignorés
    assert verifier_mot_de_passe("Awa@Test.IO!", "awa@test.io")                   # proche de l'e-mail mais différent : accepté


def test_le_changement_de_mot_de_passe_utilise_le_meme_validateur():
    with pytest.raises(ValidationError) as e:
        ChangerMotDePasseRequest(ancien_mot_de_passe="x", nouveau_mot_de_passe="court")
    assert MESSAGE_TROP_COURT in e.value.errors()[0]["msg"]
    assert ChangerMotDePasseRequest(ancien_mot_de_passe="x", nouveau_mot_de_passe="12345678").nouveau_mot_de_passe == "12345678"


@pytest.mark.parametrize("mot_de_passe", ["", "a", "1234567", "sept777"])
def test_creation_mot_de_passe_trop_court_refuse(ctx, mot_de_passe):
    avant = _nb(ctx, Utilisateur)
    r = _creer(ctx, password=mot_de_passe)
    assert r.status_code == 422 and MESSAGE_TROP_COURT in _detail(r)
    assert _nb(ctx, Utilisateur) == avant


def test_creation_mot_de_passe_egal_a_l_email_refuse(ctx):
    avant = _nb(ctx, Utilisateur)
    for email, mdp in [("egal.email@test.io", "egal.email@test.io"), ("Egal.Email@Test.io", "egal.email@test.io"),
                       ("egal.email@test.io", "  EGAL.EMAIL@test.io ")]:
        r = _creer(ctx, email=email, password=mdp)
        assert r.status_code == 422 and MESSAGE_EGAL_EMAIL in _detail(r), (email, mdp)
    assert _nb(ctx, Utilisateur) == avant


def test_creation_mot_de_passe_valide_et_absent(ctx):
    r = _creer(ctx, password="12345678")                                          # 8 caractères : accepté
    assert r.status_code == 201
    db = ctx.Session()
    assert verify_password("12345678", db.get(Utilisateur, UUID(r.json()["id"])).mot_de_passe_hash)
    longue = "é" * 300                                                            # pas de maximum : Argon2id (pas de limite à 72 octets)
    assert _creer(ctx, password=longue).status_code == 201
    corps = _corps_am(ctx); corps.pop("password")
    avant = _nb(ctx, Utilisateur)
    absent = _envoyer(ctx, "POST", "/utilisateurs/", ctx.cx_a, corps)
    assert absent.status_code == 422 and "obligatoire" in _detail(absent) and _nb(ctx, Utilisateur) == avant


def test_modification_mot_de_passe_refus_et_succes(ctx):
    cible = ctx.am_a1
    db = ctx.Session(); ancien_hash = db.get(Utilisateur, cible).mot_de_passe_hash; db.close()
    email = _email_de(ctx, cible)
    for mdp, message in [("court", MESSAGE_TROP_COURT), ("", MESSAGE_TROP_COURT), (email, MESSAGE_EGAL_EMAIL), (email.upper(), MESSAGE_EGAL_EMAIL)]:
        r = _modifier(ctx, cible, {"password": mdp})
        assert r.status_code == 422 and message in _detail(r), mdp
    r = _modifier(ctx, cible, {"email": "nouvel.email@test.io", "password": "nouvel.email@test.io"})   # égal au NOUVEL e-mail du même envoi
    assert r.status_code == 422 and MESSAGE_EGAL_EMAIL in _detail(r)
    db = ctx.Session(); u = db.get(Utilisateur, cible)
    assert u.mot_de_passe_hash == ancien_hash and u.email == email               # rien n'a changé
    db.close()
    ok = _modifier(ctx, cible, {"password": "Nouveau-Motdepasse-1"})
    assert ok.status_code == 200
    db = ctx.Session(); assert verify_password("Nouveau-Motdepasse-1", db.get(Utilisateur, cible).mot_de_passe_hash); db.close()
    sans = _modifier(ctx, cible, {"nom": "Autre"})                                # absent = inchangé
    assert sans.status_code == 200
    db = ctx.Session(); assert verify_password("Nouveau-Motdepasse-1", db.get(Utilisateur, cible).mot_de_passe_hash); db.close()


def test_changement_de_son_propre_mot_de_passe_refuse_l_email(ctx):
    ctx.client.app.include_router(auth_endpoints.router, prefix="/auth")
    email = _email_de(ctx, ctx.am_a1)
    url = "/auth/me/mot-de-passe"
    refus = _envoyer(ctx, "POST", url, ctx.am_a1, {"ancien_mot_de_passe": "Motdepasse-123", "nouveau_mot_de_passe": email})
    assert refus.status_code == 422 and MESSAGE_EGAL_EMAIL in _detail(refus)
    court = _envoyer(ctx, "POST", url, ctx.am_a1, {"ancien_mot_de_passe": "Motdepasse-123", "nouveau_mot_de_passe": "court"})
    assert court.status_code == 422 and MESSAGE_TROP_COURT in _detail(court)
    db = ctx.Session(); assert verify_password("Motdepasse-123", db.get(Utilisateur, ctx.am_a1).mot_de_passe_hash); db.close()
    ok = _envoyer(ctx, "POST", url, ctx.am_a1, {"ancien_mot_de_passe": "Motdepasse-123", "nouveau_mot_de_passe": "Autre-Motdepasse-9"})
    assert ok.status_code == 200


def test_le_mot_de_passe_n_apparait_ni_dans_les_erreurs_ni_dans_les_logs(ctx, caplog):
    secret = MOT_DE_PASSE_SECRET
    with caplog.at_level(logging.DEBUG):
        reponses = [
            _creer(ctx, password="abc"),                                                          # trop court
            _creer(ctx, email=secret + "@test.io", password=secret + "@test.io"),                  # égal à l'e-mail
            _creer(ctx, role="inconnu", password=secret),                                          # autre erreur de validation du même corps
            _modifier(ctx, ctx.am_a1, {"password": "x" * 3}),
            _envoyer(ctx, "PATCH", f"/alertes/agences/{ctx.a1}/seuil", ctx.cx_a, {"seuil_alerte": secret, "password": secret}),
        ]
    for r in reponses:
        assert r.status_code in (422,), r.text
        assert secret not in r.text and "abc" not in r.text and '"input"' not in r.text
    assert secret not in caplog.text


# ═════════════════════════ 3. E-mail ═════════════════════════

def test_creation_doublon_exact_de_casse_et_d_une_autre_organisation(ctx):
    avant = _nb(ctx, Utilisateur)
    existant = _email_de(ctx, ctx.am_a2)
    autre_org = _email_de(ctx, ctx.cx_b)
    for email in [existant, existant.upper(), "  " + existant.title() + " ", autre_org, autre_org.upper()]:
        r = _creer(ctx, email=email)
        assert r.status_code == 400 and r.json()["detail"] == "Email déjà utilisé", email
    assert _nb(ctx, Utilisateur) == avant


def test_creation_stocke_l_email_normalise(ctx):
    r = _creer(ctx, email="  Nouveau.AM@Test.IO ")
    assert r.status_code == 201 and r.json()["email"] == "nouveau.am@test.io"
    assert _creer(ctx, email="NOUVEAU.am@test.io").status_code == 400            # le même, autre casse


def test_modification_email_en_doublon_donne_400_comme_a_la_creation(ctx):
    cible, autre = ctx.am_a1, ctx.am_a2
    mon_email = _email_de(ctx, cible)
    for email in [_email_de(ctx, autre), _email_de(ctx, autre).upper(), _email_de(ctx, ctx.cx_b), "  " + _email_de(ctx, ctx.cx_b).upper()]:
        r = _modifier(ctx, cible, {"email": email})
        assert r.status_code == 400 and r.json()["detail"] == "Email déjà utilisé", email
        assert _email_de(ctx, cible) == mon_email                                 # inchangé après le refus


def test_modification_email_inchange_ou_nouveau_est_accepte(ctx):
    cible = ctx.am_a1
    mon_email = _email_de(ctx, cible)
    assert _modifier(ctx, cible, {"email": mon_email}).status_code == 200         # inchangé : pas d'erreur
    assert _modifier(ctx, cible, {"email": mon_email.upper(), "nom": "Autre"}).status_code == 200   # même adresse, autre casse : c'est le même compte
    assert _email_de(ctx, cible) == mon_email.lower()
    r = _modifier(ctx, cible, {"email": "  Tout.Neuf@Test.IO "})
    assert r.status_code == 200 and _email_de(ctx, cible) == "tout.neuf@test.io"
    assert _modifier(ctx, cible, {"email": None}).status_code == 422             # null explicite : refusé, pas de 500


def test_collision_simultanee_donne_aussi_400_et_non_500(ctx, monkeypatch):
    # Le contrôle préalable ne voit rien (course entre deux requêtes) : la contrainte d'unicité de la base répond, même message.
    from app.api.v1.endpoints import utilisateurs
    monkeypatch.setattr(utilisateurs, "_email_deja_pris", lambda *args, **kwargs: False)
    existant = _email_de(ctx, ctx.am_a2)
    avant = _nb(ctx, Utilisateur)
    r = _creer(ctx, email=existant)
    assert r.status_code == 400 and r.json()["detail"] == "Email déjà utilisé" and _nb(ctx, Utilisateur) == avant
    r2 = _modifier(ctx, ctx.am_a1, {"email": existant})
    assert r2.status_code == 400 and r2.json()["detail"] == "Email déjà utilisé"


# ═════════════════════════ 4. Responsable d'agence sans agence ═════════════════════════

def test_creation_sans_agence_refusee(ctx):
    avant = _nb(ctx, Utilisateur)
    corps = _corps_am(ctx); corps.pop("agence_id")
    r = _envoyer(ctx, "POST", "/utilisateurs/", ctx.cx_a, corps)
    assert r.status_code == 422 and "rattaché à une agence" in _detail(r)
    nul = _creer(ctx, agence_id=None)
    assert nul.status_code == 422 and "rattaché à une agence" in _detail(nul)
    assert _nb(ctx, Utilisateur) == avant


def test_creation_avec_une_agence_de_mon_organisation_acceptee(ctx):
    for agence in (ctx.a1, ctx.a2):
        r = _creer(ctx, agence_id=str(agence))
        assert r.status_code == 201 and r.json()["agence_id"] == str(agence)


def test_creation_avec_une_agence_d_une_autre_organisation_refusee(ctx):
    avant = _nb(ctx, Utilisateur)
    r = _creer(ctx, agence_id=str(ctx.b1))
    assert r.status_code == 403 and _nb(ctx, Utilisateur) == avant
    inconnue = _creer(ctx, agence_id=str(uuid4()))
    assert inconnue.status_code == 403 and _nb(ctx, Utilisateur) == avant


def test_les_comptes_existants_sans_agence_ne_sont_pas_modifies(ctx):
    r = _modifier(ctx, ctx.am_sans_agence, {"nom": "Renommé"})
    assert r.status_code == 200 and r.json()["agence_id"] is None
    db = ctx.Session(); assert db.get(Utilisateur, ctx.am_sans_agence).agence_id is None; db.close()


def test_compte_ancien_a_l_adresse_en_majuscules_bloque_aussi_le_doublon_de_casse(ctx):
    """Avant la normalisation, un compte pouvait être enregistré avec des majuscules (« Mixte.Case@… ») : la contrainte d'unicité
    de la base, sensible à la casse, ne verrait pas le doublon « mixte.case@… ». Le contrôle préalable, lui, doit le voir."""
    db = ctx.Session()
    ancien = Utilisateur(id=uuid4(), organisation_id=ctx.org_b, nom="Ancien", prenom="Compte", email="Mixte.Case@Test.io",
                         mot_de_passe_hash="x", role=ctx.cx_b and db.get(Utilisateur, ctx.cx_b).role, active=True)
    db.add(ancien); db.commit(); db.close()
    avant = _nb(ctx, Utilisateur)
    r = _creer(ctx, email="mixte.case@test.io")
    assert r.status_code == 400 and r.json()["detail"] == "Email déjà utilisé" and _nb(ctx, Utilisateur) == avant
    m = _modifier(ctx, ctx.am_a1, {"email": "MIXTE.CASE@test.io"})
    assert m.status_code == 400 and m.json()["detail"] == "Email déjà utilisé"
    assert _email_de(ctx, ctx.am_a1) != "mixte.case@test.io"
