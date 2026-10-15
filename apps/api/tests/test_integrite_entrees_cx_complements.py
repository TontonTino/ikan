"""
PR A, compléments — mot de passe et espaces, connexion sans jokers, détachement d'un responsable d'agence, lecture de données
déjà enregistrées hors règle (les schémas de RÉPONSE ne sont pas stricts).

Même fixture (deux organisations A et B, vrai routeur, vrai JWT, SQLite en mémoire) que test_integrite_entrees_cx.py, avec en plus le
routeur d'authentification pour tester la connexion réelle.
"""
from uuid import UUID, uuid4

import pytest

from app.api.v1.endpoints import auth as auth_endpoints
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import create_access_token, get_password_hash, verify_password
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur
from app.schemas.mot_de_passe import MESSAGE_TROP_COURT
from tests.test_integrite_entrees_cx import _creer, _detail, _email_de, _envoyer, _modifier, _nb
from tests.test_isolation_multi_org import ctx  # noqa: F401  (fixture réutilisée)

MOT_DE_PASSE = "Motdepasse-123"


@pytest.fixture(autouse=True)
def _app_complete(ctx):  # noqa: F811
    installer_erreurs_validation(ctx.client.app)
    ctx.client.app.include_router(auth_endpoints.router, prefix="/auth")


def _se_connecter(ctx, email, mot_de_passe):
    return ctx.client.post("/auth/login", json={"email": email, "password": mot_de_passe})


def _ajouter_compte(ctx, email, mot_de_passe=MOT_DE_PASSE, role=UserRole.CX_MANAGER, organisation=None):
    db = ctx.Session()
    try:
        compte = Utilisateur(id=uuid4(), organisation_id=organisation or ctx.org_a, nom="N", prenom="P", email=email,
                             mot_de_passe_hash=get_password_hash(mot_de_passe), role=role, active=True)
        db.add(compte); db.commit()
        return compte.id
    finally:
        db.close()


def _hash_de(ctx, user_id):
    db = ctx.Session()
    try:
        return db.get(Utilisateur, user_id).mot_de_passe_hash
    finally:
        db.close()


# ═════════════════════════ 1. Mot de passe et espaces ═════════════════════════

@pytest.mark.parametrize("mot_de_passe", ["        ", "   abc   ", "  1234567  ", "\t\t\t\t\t\t\t\t", " " * 9])
def test_creation_refuse_un_mot_de_passe_trop_court_apres_suppression_des_espaces(ctx, mot_de_passe):
    avant = _nb(ctx, Utilisateur)
    r = _creer(ctx, password=mot_de_passe)
    assert r.status_code == 422 and MESSAGE_TROP_COURT in _detail(r)
    assert _nb(ctx, Utilisateur) == avant


def test_un_mot_de_passe_valide_avec_espaces_autour_est_enregistre_sans_eux_et_permet_la_connexion(ctx):
    email = f"{uuid4().hex[:8]}@test.io"
    r = _creer(ctx, email=email, password="  12345678  ")                    # 8 caractères une fois les espaces retirés
    assert r.status_code == 201
    hash_ = _hash_de(ctx, UUID(r.json()["id"]))
    assert verify_password("12345678", hash_) and not verify_password("  12345678  ", hash_)   # c'est la valeur sans espaces qui est hachée
    assert _se_connecter(ctx, email, "12345678").status_code == 200
    assert _se_connecter(ctx, email, "  12345678  ").status_code == 200       # la connexion retire aussi ces espaces


def test_un_mot_de_passe_valide_avec_espaces_au_milieu_fonctionne_a_la_connexion(ctx):
    email = f"{uuid4().hex[:8]}@test.io"
    r = _creer(ctx, email=email, password="Ma phrase de passe")
    assert r.status_code == 201
    assert verify_password("Ma phrase de passe", _hash_de(ctx, UUID(r.json()["id"])))      # espaces du milieu conservés
    assert _se_connecter(ctx, email, "Ma phrase de passe").status_code == 200
    assert _se_connecter(ctx, email, "Maphrasedepasse").status_code == 401                 # ils comptent dans le mot de passe


def test_un_mot_de_passe_valide_sans_espace_reste_accepte(ctx):
    email = f"{uuid4().hex[:8]}@test.io"
    assert _creer(ctx, email=email, password="12345678").status_code == 201
    assert _se_connecter(ctx, email, "12345678").status_code == 200


def test_modification_applique_la_meme_regle_sur_le_mot_de_passe_sans_espaces(ctx):
    cible = ctx.am_a1
    avant = _hash_de(ctx, cible)
    for mdp in ["        ", "   abc   ", "  1234567  "]:
        r = _modifier(ctx, cible, {"password": mdp})
        assert r.status_code == 422 and MESSAGE_TROP_COURT in _detail(r), repr(mdp)
    assert _hash_de(ctx, cible) == avant                                       # inchangé après les refus
    ok = _modifier(ctx, cible, {"password": "  Nouveau pass 99  "})
    assert ok.status_code == 200
    assert _se_connecter(ctx, _email_de(ctx, cible), "Nouveau pass 99").status_code == 200


def test_changement_de_son_propre_mot_de_passe_applique_la_meme_regle(ctx):
    url = "/auth/me/mot-de-passe"
    for mdp in ["        ", "  1234567  "]:
        r = _envoyer(ctx, "POST", url, ctx.am_a1, {"ancien_mot_de_passe": MOT_DE_PASSE, "nouveau_mot_de_passe": mdp})
        assert r.status_code == 422 and MESSAGE_TROP_COURT in _detail(r)
    ok = _envoyer(ctx, "POST", url, ctx.am_a1, {"ancien_mot_de_passe": MOT_DE_PASSE, "nouveau_mot_de_passe": "  Autre mot 99  "})
    assert ok.status_code == 200
    assert _se_connecter(ctx, _email_de(ctx, ctx.am_a1), "Autre mot 99").status_code == 200


# ═════════════════════════ 2. Connexion et e-mail (sans jokers) ═════════════════════════

def test_connexion_avec_une_casse_differente_reussit(ctx):
    email = _email_de(ctx, ctx.cx_a)
    assert _se_connecter(ctx, email, MOT_DE_PASSE).status_code == 200
    assert _se_connecter(ctx, email.upper(), MOT_DE_PASSE).status_code == 200
    assert _se_connecter(ctx, "  " + email.title() + " ", MOT_DE_PASSE).status_code == 200


def test_un_trait_de_soulignement_n_est_pas_un_joker(ctx):
    _ajouter_compte(ctx, "axb@x.io")
    assert _se_connecter(ctx, "axb@x.io", MOT_DE_PASSE).status_code == 200      # cas positif jumelé
    r = _se_connecter(ctx, "a_b@x.io", MOT_DE_PASSE)                             # avec ilike : « _ » = n'importe quel caractère
    assert r.status_code == 401 and r.json()["detail"] == "Email ou mot de passe incorrect"


def test_un_pourcent_n_est_pas_un_joker(ctx):
    _ajouter_compte(ctx, "quelquun@x.io")
    r = _se_connecter(ctx, "%@x.io", MOT_DE_PASSE)
    assert r.status_code == 401 and r.json()["detail"] == "Email ou mot de passe incorrect"
    assert _se_connecter(ctx, "quelquun@x.io", MOT_DE_PASSE).status_code == 200


def test_un_compte_ancien_enregistre_en_majuscules_se_connecte_toujours(ctx):
    _ajouter_compte(ctx, "Ancien.MAJ@Test.io")
    for saisie in ["Ancien.MAJ@Test.io", "ancien.maj@test.io", "ANCIEN.MAJ@TEST.IO"]:
        assert _se_connecter(ctx, saisie, MOT_DE_PASSE).status_code == 200, saisie


def test_mauvais_mot_de_passe_meme_message_qu_un_compte_inconnu(ctx):
    email = _email_de(ctx, ctx.cx_a)
    mauvais = _se_connecter(ctx, email, "Pas-le-bon-mot-de-passe")
    inconnu = _se_connecter(ctx, "personne@nulle-part.io", "Pas-le-bon-mot-de-passe")
    assert mauvais.status_code == inconnu.status_code == 401
    assert mauvais.json() == inconnu.json() == {"detail": "Email ou mot de passe incorrect"}   # aucune différence de message


# ═════════════════════════ 3. Détachement d'un responsable d'agence ═════════════════════════

def _agence_de(ctx, user_id):
    db = ctx.Session()
    try:
        return db.get(Utilisateur, user_id).agence_id
    finally:
        db.close()


def test_detachement_d_un_am_refuse_et_base_inchangee(ctx):
    for corps in [{"agence_id": None}, {"agence_id": None, "nom": "Autre"}]:
        r = _modifier(ctx, ctx.am_a1, corps)
        assert r.status_code == 422 and "détaché de son agence" in _detail(r)
        assert _agence_de(ctx, ctx.am_a1) == ctx.a1
        db = ctx.Session(); assert db.get(Utilisateur, ctx.am_a1).nom == "N"; db.close()


def test_changement_d_agence_dans_la_meme_organisation_accepte(ctx):
    r = _modifier(ctx, ctx.am_a1, {"agence_id": str(ctx.a2)})
    assert r.status_code == 200 and _agence_de(ctx, ctx.am_a1) == ctx.a2


def test_changement_vers_une_agence_d_une_autre_organisation_refuse_et_base_inchangee(ctx):
    r = _modifier(ctx, ctx.am_a1, {"agence_id": str(ctx.b1)})
    assert r.status_code == 403 and _agence_de(ctx, ctx.am_a1) == ctx.a1


def test_un_compte_existant_sans_agence_reste_inchange_tant_qu_on_ne_le_modifie_pas(ctx):
    assert _agence_de(ctx, ctx.am_sans_agence) is None
    assert _modifier(ctx, ctx.am_sans_agence, {"nom": "Renommé"}).status_code == 200      # autre champ : possible
    assert _agence_de(ctx, ctx.am_sans_agence) is None
    assert _modifier(ctx, ctx.am_sans_agence, {"agence_id": None}).status_code == 422     # mais pas de null explicite
    assert _modifier(ctx, ctx.am_sans_agence, {"agence_id": str(ctx.a1)}).status_code == 200   # le rattacher reste possible
    assert _agence_de(ctx, ctx.am_sans_agence) == ctx.a1


# ═════════════════════════ 4a. Lecture de valeurs déjà enregistrées hors règle ═════════════════════════

def test_une_valeur_deja_en_base_hors_regle_ne_fait_pas_planter_la_lecture(ctx):
    db = ctx.Session()
    db.get(Agence, ctx.a1).seuil_alerte = 150.0
    db.get(Agence, ctx.a2).seuil_alerte = -5.0
    db.commit(); db.close()
    majuscules = _ajouter_compte(ctx, "Ancien.CX@EXEMPLE.COM", role=UserRole.AGENCY_MANAGER)
    db = ctx.Session(); db.get(Utilisateur, majuscules).agence_id = ctx.a1; db.commit(); db.close()

    lecture = ctx.client.get(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_a))
    assert lecture.status_code == 200 and lecture.json()["seuil_alerte"] == 150.0
    liste = ctx.client.get("/agences/", headers=ctx.H(ctx.cx_a))
    assert liste.status_code == 200 and {a["seuil_alerte"] for a in liste.json()} >= {150.0, -5.0}
    assert ctx.client.get("/agences/contexte", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get("/alertes/", headers=ctx.H(ctx.cx_a)).status_code == 200

    comptes = ctx.client.get("/utilisateurs/", headers=ctx.H(ctx.cx_a))
    assert comptes.status_code == 200 and "Ancien.CX@EXEMPLE.COM" in {u["email"] for u in comptes.json()}
    un = ctx.client.get(f"/utilisateurs/{majuscules}", headers=ctx.H(ctx.cx_a))
    assert un.status_code == 200 and un.json()["email"] == "Ancien.CX@EXEMPLE.COM"
    moi = ctx.client.get("/auth/me", headers={"Authorization": f"Bearer {create_access_token(majuscules)}"})
    assert moi.status_code == 200 and moi.json()["email"] == "Ancien.CX@EXEMPLE.COM"
    # Et la connexion de ce compte fonctionne, quelle que soit la casse saisie.
    assert _se_connecter(ctx, "ancien.cx@exemple.com", MOT_DE_PASSE).status_code == 200
