"""
Résolution de la clé de modèle d'une catégorie (AM-03 : recommandations ; réutilisée par le futur brouillon de réponse AM-09).
Avant : le modèle était cherché avec le NOM de la catégorie (« Accueil »), presque toujours absent des clés (« accueil »), d'où le
modèle générique « autre » pour presque tous les avis.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.session import Base
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.enums import CriticiteType
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.services.ai.analyse_service import analyser_feedback
from app.services.ai.cles_modeles import (
    CLE_VERS_FAMILLE, FAMILLES_MOTS_CLES, MODELE_PAR_DEFAUT, cle_modele_de_categorie, normaliser_cle, resoudre_cle_modele,
)
from app.services.ai.recommandations import RECOMMANDATIONS_TEMPLATES as MODELES, generer_recommandations
from app.services.categorie_templates import SECTEUR_CATEGORIES_DEPART

DISPONIBLES = set(MODELES)

# Table attendue, écrite À PART du code : elle fige le choix métier de chaque clé de départ (une dérive casse le test).
ATTENDU_DEPART = {
    ("telecom", "accueil"): "accueil",
    ("telecom", "service_client"): "resolution_probleme",
    ("telecom", "carte_sim_numero"): "qualite_produit",
    ("telecom", "forfaits_recharge"): "qualite_produit",
    ("telecom", "internet_reseau_mobile"): "reseau",
    ("telecom", "facturation_paiement"): "facturation",
    ("telecom", "equipements_boutique"): "qualite_produit",
    ("telecom", "mobile_money"): "autre",
    ("restauration", "accueil_service_salle"): "accueil",
    ("restauration", "qualite_plats"): "qualite_produit",
    ("restauration", "rapidite_attente"): "attente",
    ("restauration", "proprete_cadre"): "proprete_cadre",
    ("restauration", "addition_paiement"): "facturation",
    ("restauration", "livraison_emporter"): "livraison_logistique",
    ("restauration", "suggestion_compliment"): "autre",       # un compliment n'a pas de modèle correctif : seul cas légitime
}


def resoudre(cle=None, nom=None):
    return resoudre_cle_modele(cle, nom, DISPONIBLES)


# ───────────────────────── normalisation ─────────────────────────

@pytest.mark.parametrize("brut,attendu", [
    ("Accueil", "accueil"), ("ACCUEIL ", "accueil"), ("  accueil", "accueil"), ("Service Client", "service_client"),
    ("service-client", "service_client"), ("Carte SIM & Numéro", "carte_sim_numero"), ("Rapidité / Attente", "rapidite_attente"),
    ("Équipements & Boutique", "equipements_boutique"), ("l'accueil", "l_accueil"), ("", ""), (None, ""), ("---", ""),
])
def test_normalisation(brut, attendu):
    assert normaliser_cle(brut) == attendu


# ───────────────────────── résolution ─────────────────────────

@pytest.mark.parametrize("nom,attendu", [
    ("Accueil", "accueil"), ("accueil", "accueil"), ("ACCUEIL ", "accueil"), ("Service Client", "resolution_probleme"),
    ("service_client", "resolution_probleme"), ("Réseau", "reseau"), ("attente", "attente"),
])
def test_noms_et_cles_sans_cle_stable(nom, attendu):
    assert resoudre(nom=nom) == attendu


def test_ordre_la_cle_stable_passe_avant_le_nom():
    assert resoudre(cle="reseau", nom="Accueil") == "reseau"
    assert resoudre(cle="service_client", nom="Relation clientèle") == "resolution_probleme"   # nom libre : seule la clé sait
    assert resoudre(cle="forfaits_recharge", nom=None) == "qualite_produit"


def test_une_cle_inconnue_retombe_sur_le_nom_puis_sur_autre():
    assert resoudre(cle="cle_inconnue_xyz", nom="Accueil") == "accueil"
    assert resoudre(cle="cle_inconnue_xyz", nom="Quelque chose") == "autre"
    assert resoudre(cle="cle_inconnue_xyz", nom=None) == "autre"


@pytest.mark.parametrize("nom,attendu", [
    ("Facturation & Paiement", "facturation"), ("Temps d'attente en caisse", "attente"), ("Propreté des locaux", "proprete_cadre"),
    ("Application mobile", "application_mobile"), ("Livraison à domicile", "livraison_logistique"), ("Prix et tarifs", "tarifs"),
    ("Qualité des produits", "qualite_produit"), ("Réclamations", "resolution_probleme"), ("Sécurité des données", "securite_confidentialite"),
])
def test_categorie_libre_sans_cle_par_famille(nom, attendu):
    assert resoudre(nom=nom) == attendu


@pytest.mark.parametrize("nom", ["Caisse", "Divers", "Zzz", "Savoir-faire", "Cafétéria"])
def test_categorie_libre_sans_correspondance_donne_autre(nom):
    assert resoudre(nom=nom) == "autre"          # « sav » ne doit pas se déclencher dans « Savoir-faire »


def test_categorie_absente_ou_vide():
    assert resoudre() == "autre"
    assert resoudre(cle="", nom="  ") == "autre"
    assert cle_modele_de_categorie(None, DISPONIBLES) == "autre"
    assert cle_modele_de_categorie(SimpleNamespace(cle=None, nom="Accueil"), DISPONIBLES) == "accueil"
    assert cle_modele_de_categorie(SimpleNamespace(cle="mobile_money", nom="Mobile Money"), DISPONIBLES) == "autre"


def test_un_modele_indisponible_n_est_jamais_renvoye():
    """Un autre jeu de textes (brouillons de réponse) peut avoir moins de familles : on ne sort jamais de ses clés."""
    assert resoudre_cle_modele("reseau", "Réseau", {"accueil", "autre"}) == "autre"
    assert resoudre_cle_modele("service_client", None, {"accueil", "autre"}) == "autre"      # famille « resolution_probleme » absente
    assert resoudre_cle_modele(None, "Accueil", {"accueil", "autre"}) == "accueil"


# ───────────────────────── les clés de départ des secteurs ─────────────────────────

def _cles_de_depart():
    return [(secteur, c) for secteur, liste in SECTEUR_CATEGORIES_DEPART.items() for c in liste]


def test_chaque_cle_de_depart_a_son_modele_attendu():
    vues = {(secteur, c.cle) for secteur, c in _cles_de_depart()}
    assert vues == set(ATTENDU_DEPART), f"clés de départ non couvertes ou en trop : {vues ^ set(ATTENDU_DEPART)}"
    for secteur, c in _cles_de_depart():
        attendu = ATTENDU_DEPART[(secteur, c.cle)]
        assert resoudre(cle=c.cle) == attendu, (secteur, c.cle)
        assert resoudre(cle=c.cle, nom=c.libelle) == attendu, (secteur, c.cle)
        assert resoudre(nom=c.libelle) == attendu, f"le libellé « {c.libelle} » (sans clé) doit donner le même modèle"


def test_jamais_autre_quand_un_modele_existe():
    for secteur, c in _cles_de_depart():
        if c.cle not in {"suggestion_compliment", "mobile_money"}:   # les deux seuls cas légitimes sur « autre »
            assert resoudre(cle=c.cle) != MODELE_PAR_DEFAUT, (secteur, c.cle)


def test_toutes_les_familles_visees_existent_comme_modeles():
    assert set(CLE_VERS_FAMILLE.values()) <= DISPONIBLES
    assert {famille for famille, _ in FAMILLES_MOTS_CLES} <= DISPONIBLES
    assert MODELE_PAR_DEFAUT in DISPONIBLES


# ───────────────────────── generer_recommandations ─────────────────────────

def _texte(famille, niveau="elevee"):
    return MODELES[famille][niveau]


def test_generer_recommandations_utilise_la_cle_stable_puis_le_nom():
    assert generer_recommandations("Service Client", CriticiteType.ELEVEE, False)[0][0] == _texte("resolution_probleme")
    assert generer_recommandations("Accueil", CriticiteType.ELEVEE, False)[0][0] == _texte("accueil")
    assert generer_recommandations("ACCUEIL ", CriticiteType.CRITIQUE, False)[0][0] == _texte("accueil", "critique")
    assert generer_recommandations("Relation clientèle", CriticiteType.ELEVEE, False, cle_categorie="internet_reseau_mobile")[0][0] == _texte("reseau")
    assert generer_recommandations("Caisse", CriticiteType.ELEVEE, False)[0][0] == _texte("autre")


def test_les_appels_historiques_par_cle_sont_inchanges():
    for cle in MODELES:
        for niveau, criticite in (("elevee", CriticiteType.ELEVEE), ("critique", CriticiteType.CRITIQUE)):
            assert generer_recommandations(cle, criticite, False)[0][0] == MODELES[cle][niveau], cle


# ───────────────────────── de bout en bout : l'analyse d'un avis ─────────────────────────

@pytest.fixture()
def db():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _avis(db, categorie_nom, categorie_cle):
    organisation = Organisation(id=uuid4(), nom="Org", active=True)
    db.add(organisation); db.flush()
    agence = Agence(id=uuid4(), organisation_id=organisation.id, nom="Agence", ville="Lyon", active=True, seuil_alerte=70)
    db.add(agence); db.flush()
    qr = QRCode(id=uuid4(), agence_id=agence.id, code="QR", url="http://t/QR", actif=True)
    db.add(qr); db.flush()
    categorie = None
    if categorie_nom is not None:
        categorie = Categorie(id=uuid4(), agence_id=agence.id, nom=categorie_nom, cle=categorie_cle, active=True)
        db.add(categorie); db.flush()
    avis = Feedback(id=uuid4(), qr_code_id=qr.id, categorie_id=categorie.id if categorie else None, note=1,
                    commentaire="Service nul, très mauvais, scandaleux, inadmissible", statut_traitement="nouveau")
    db.add(avis); db.commit()
    return avis.id


def _recommandations(db, avis_id):
    from app.models.analyse_ia import AnalyseIA
    analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == avis_id).one()
    return analyse, [r.contenu for r in db.query(Recommandation).filter(Recommandation.analyse_ia_id == analyse.id).all()]


@pytest.mark.parametrize("nom,cle,famille", [
    ("Relation clientèle", "service_client", "resolution_probleme"),     # nom libre : seule la clé stable permet de choisir
    ("Service Client", None, "resolution_probleme"),                      # sans clé : le nom normalisé
    ("Accueil", None, "accueil"),
    ("Internet & Réseau Mobile", "internet_reseau_mobile", "reseau"),
    ("Caisse", None, "autre"),
    (None, None, "accueil"),                                              # avis sans catégorie : comportement historique (accueil)
])
def test_l_analyse_d_un_avis_choisit_le_bon_modele(db, nom, cle, famille):
    avis_id = _avis(db, nom, cle)
    analyser_feedback(avis_id, db)
    analyse, contenus = _recommandations(db, avis_id)
    assert analyse.criticite in (CriticiteType.ELEVEE, CriticiteType.CRITIQUE)
    niveau = "critique" if analyse.criticite == CriticiteType.CRITIQUE else "elevee"
    assert contenus[0] == MODELES[famille][niveau]
    assert analyse.theme_principal == (nom if nom is not None else "accueil")          # le thème affiché reste le nom de la catégorie


def test_une_analyse_existante_n_est_jamais_recalculee(db):
    """Les recommandations déjà en base ne sont pas régénérées : analyser_feedback ne fait rien si l'avis est déjà analysé."""
    avis_id = _avis(db, "Service Client", "service_client")
    analyser_feedback(avis_id, db)
    _, avant = _recommandations(db, avis_id)
    db.query(Recommandation).update({Recommandation.contenu: "ANCIEN TEXTE (déjà en base)"})
    db.commit()
    analyser_feedback(avis_id, db)
    _, apres = _recommandations(db, avis_id)
    assert avant != apres and apres == ["ANCIEN TEXTE (déjà en base)"] * len(avant)
