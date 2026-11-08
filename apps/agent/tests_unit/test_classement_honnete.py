"""
YAM — comparaison d'agences honnête : verdict calculé par le code, « comparaison impossible » dite clairement,
garde-fou numérique sans faux positif de structure.

Tests UNITAIRES sans base ni fournisseur IA (le LLM est une doublure scriptée ; aucun appel réel).

  python -m pytest tests_unit/test_classement_honnete.py
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")  # jamais connectée
os.environ.setdefault("SECRET_KEY", "test-secret-key-classement-0123456789abcdef")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-classement")

from app.agent import classement, qa_service, verification  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.providers.llm_provider import TexteGenere  # noqa: E402


# ───────────────────────── jeu de données (même forme que queries.query_classement_agences) ─────────────────────────
ORG = uuid.uuid4()
NOM_AVEC_AVIS = "Orange Digital Center (Cissin)"
NOMS_SANS_AVIS = [f"Agence {n}" for n in ("Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet")]


def agence(nom, nb, satisfaits, alertes=0):
    return {
        "agence_id": str(uuid.uuid4()), "agence_nom": nom,
        "satisfaction_pct": round(satisfaits / nb * 100, 1), "nb_feedbacks": nb,
        "note_moyenne": 4.5, "nb_alertes_elevees_ou_critiques": alertes, "volume_faible": nb < 5,
    }


def donnees_classement(agences, sans_avis=(), jours=30, restreint=False):
    """Même forme que queries.query_classement_agences."""
    classement = sorted(agences, key=lambda a: (a["satisfaction_pct"], -a["nb_feedbacks"], a["agence_nom"]))
    for rang, a in enumerate(classement, start=1):
        a["rang_du_moins_au_plus_satisfaisant"] = rang
    total = sum(a["nb_feedbacks"] for a in classement)
    satisfaits = sum(round(a["satisfaction_pct"] * a["nb_feedbacks"] / 100) for a in classement)
    meilleures = sorted(classement, key=lambda a: (-a["satisfaction_pct"], -a["nb_feedbacks"], a["agence_nom"]))
    return {
        "periode_jours": jours, "perimetre_restreint_a_une_agence": restreint,
        "nb_agences_classees": len(classement), "total_feedbacks": total,
        "satisfaction_globale_pct": round(satisfaits / total * 100, 1) if total else None,
        "seuil_volume_faible": 5, "plus_faibles": classement[:3], "meilleures": meilleures[:3],
        "classement_complet": classement, "agences_actives_sans_feedback": sorted(sans_avis),
    }


def cas_reel():
    return donnees_classement([agence(NOM_AVEC_AVIS, 2, 2)], NOMS_SANS_AVIS)


QUESTION_FAIBLE = "Quelle agence a la plus faible satisfaction ?"
QUESTION_FORTE = "Quelle agence a la meilleure satisfaction ?"


class Espion:
    def __init__(self, donnees):
        self.donnees = donnees
        self.llm_calls = []
        self.reponses = []

    def llm(self, system_prompt, user_prompt, *, messages_history=None, max_tokens=400):
        self.llm_calls.append({"system": system_prompt, "user": user_prompt})
        t = TexteGenere(self.reponses.pop(0))
        t.finish_reason, t.tronquee = "stop", False
        return t


def _installer(monkeypatch, donnees):
    e = Espion(donnees)
    monkeypatch.setattr(qa_service.llm_provider, "generate_text", e.llm)
    monkeypatch.setattr(qa_service.queries, "lister_agences_organisation", lambda db, org: [])
    monkeypatch.setattr(qa_service.queries, "get_secteur_organisation", lambda db, org: None)
    monkeypatch.setattr(qa_service.queries, "verifier_agence_dans_organisation", lambda db, org, a: None)
    monkeypatch.setattr(
        qa_service.queries, "query_classement_agences", lambda db, org, agence_id=None, jours=30: e.donnees
    )
    return e


def poser(question=QUESTION_FAIBLE, role=UserRole.CX_MANAGER):
    return qa_service.repondre_question(None, ORG, question, jours=30, role=role)


# ───────────────────────── 1. le cas réel : 1 agence avec 2 avis positifs, 10 sans avis ─────────────────────────

# Ce que le modèle écrivait avant : verdict « la plus faible » alors que le tableau disait « la plus élevée ».
REPONSE_CONTRADICTOIRE_DU_MODELE = (
    "Verdict : l'agence Orange Digital Center (Cissin) est celle avec la satisfaction la plus faible.\n\n"
    "| Rang | Agence | Satisfaction |\n|---|---|---|\n"
    "| 1 | Orange Digital Center (Cissin) | la plus élevée (tous les avis sont positifs) |\n\n"
    "Top 3 des agences à suivre."
)


def test_cas_reel_une_seule_agence_avec_avis_pas_de_verdict_et_vrais_chiffres(monkeypatch):
    e = _installer(monkeypatch, cas_reel())
    e.reponses = [REPONSE_CONTRADICTOIRE_DU_MODELE]
    res = poser()
    texte = res["reponse"]
    assert e.llm_calls == [], "aucun appel au modèle : il ne peut pas écrire de verdict"
    assert res["intention"] == "classement_agences" and res["donnees"]["comparaison_possible"] is False
    assert "Je ne peux pas comparer vos agences" in texte
    assert "1 agence a reçu des avis sur les 30 derniers jours (2 avis au total)" in texte
    assert "10 agences actives n’en ont aucun" in texte
    assert f"- {NOM_AVEC_AVIS} : 2 avis, 100 % de clients satisfaits" in texte
    assert "trop faible" in texte and "Agence Alpha" in texte and "Agence Juliet" in texte
    assert "ce trimestre" in texte and "sans avis" in texte  # la suite utile
    assert "la plus faible" not in texte and "la plus élevée" not in texte and "Vérification automatique" not in texte
    assert res["avertissements"] == []


def test_deux_agences_dont_une_seule_au_dessus_du_volume_pas_de_comparaison(monkeypatch):
    donnees = donnees_classement([agence("Agence Grande", 40, 12), agence("Agence Petite", 3, 0)], ["Agence Muette"])
    e = _installer(monkeypatch, donnees)
    res = poser()
    assert e.llm_calls == []
    assert "Je ne peux pas comparer" in res["reponse"]
    assert "2 agences ont reçu des avis" in res["reponse"] and "(43 avis au total)" in res["reponse"]
    assert "Agence Grande : 40 avis, 30 % de clients satisfaits" in res["reponse"]
    assert "Agence Petite : 3 avis, 0 % de clients satisfaits" in res["reponse"] and "trop faible" in res["reponse"]
    assert "1 agence active n’en a aucun" in res["reponse"]
    assert "la plus faible" not in res["reponse"] and "la plus élevée" not in res["reponse"]


def test_aucune_agence_avec_avis(monkeypatch):
    e = _installer(monkeypatch, donnees_classement([], NOMS_SANS_AVIS))
    res = poser()
    assert e.llm_calls == []
    assert "Aucune agence n'a reçu d'avis sur les 30 derniers jours (10 agences actives sans avis)." in res["reponse"]
    assert "la plus" not in res["reponse"]


def test_beaucoup_d_agences_sans_avis_la_liste_est_tronquee_avec_le_vrai_reste(monkeypatch):
    noms = [f"Agence Z{chr(97 + i)}" for i in range(15)]
    _installer(monkeypatch, donnees_classement([], noms))
    res = poser()
    assert "Agence Za" in res["reponse"] and "Agence Zl" in res["reponse"] and "Agence Zm" not in res["reponse"]
    assert "et 3 autres" in res["reponse"]


# ───────────────────────── 2. comparaison normale : verdict calculé et cohérent ─────────────────────────

DEUX_SUFFISANTES = [agence("Agence Nord", 10, 3), agence("Agence Sud", 8, 6)]  # Nord 30 %, Sud 75 %


def test_deux_agences_suffisantes_verdict_calcule_en_tete_pour_la_plus_faible(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Sud devance Nord de façon nette ; Nord concentre 10 avis."]
    res = poser(QUESTION_FAIBLE)
    assert len(e.llm_calls) == 1
    assert res["reponse"].startswith("L'agence Agence Nord a la satisfaction la plus faible : 30 % sur 10 avis.")
    assert "Agence Sud a la satisfaction" not in res["reponse"].split("\n\n")[0]
    assert "Sud devance Nord" in res["reponse"] and res["avertissements"] == []
    assert "n'écris AUCUNE phrase de verdict" in e.llm_calls[0]["system"]


def test_verdict_pour_la_plus_forte(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Commentaire."]
    res = poser(QUESTION_FORTE)
    assert res["reponse"].startswith("L'agence Agence Sud a la satisfaction la plus élevée : 75 % sur 8 avis.")


def test_question_sans_sens_donne_les_deux_extremes(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Commentaire."]
    res = poser("Compare mes agences")
    premier = res["reponse"].split("\n\n")[0]
    assert "Agence Nord a la satisfaction la plus faible" in premier
    assert "Agence Sud a la satisfaction la plus élevée" in premier


def test_phrase_du_modele_qui_contredit_le_classement_est_retiree_et_signalee(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["L'agence Agence Sud est celle avec la satisfaction la plus faible.\nNord reste en retrait avec 10 avis."]
    res = poser(QUESTION_FAIBLE)
    assert "Agence Sud est celle avec la satisfaction la plus faible" not in res["reponse"]
    assert res["reponse"].startswith("L'agence Agence Nord a la satisfaction la plus faible")
    assert "Nord reste en retrait" in res["reponse"]
    assert "verdict_modele_contradictoire_retire" in res["avertissements"]


def test_ligne_du_modele_coherente_avec_le_classement_est_conservee(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["| 1 | Agence Nord | la plus faible |\n| 2 | Agence Sud | la plus élevée |"]
    res = poser(QUESTION_FAIBLE)
    assert "| 1 | Agence Nord | la plus faible |" in res["reponse"]
    assert "| 2 | Agence Sud | la plus élevée |" in res["reponse"]
    assert res["avertissements"] == []


def test_agence_a_petit_volume_ne_peut_pas_etre_le_verdict(monkeypatch):
    donnees = donnees_classement(DEUX_SUFFISANTES + [agence("Agence Minuscule", 2, 0)])  # 0 % mais 2 avis
    e = _installer(monkeypatch, donnees)
    e.reponses = ["Commentaire."]
    res = poser(QUESTION_FAIBLE)
    assert res["reponse"].startswith("L'agence Agence Nord a la satisfaction la plus faible")
    assert "Minuscule" not in res["reponse"].split("\n\n")[0]


def test_egalite_parfaite_aucune_agence_ne_se_distingue(monkeypatch):
    donnees = donnees_classement([agence("Agence A", 10, 5), agence("Agence B", 6, 3)])
    e = _installer(monkeypatch, donnees)
    e.reponses = ["Commentaire."]
    res = poser(QUESTION_FAIBLE)
    assert "toutes la même satisfaction (50 %)" in res["reponse"] and "aucune ne se distingue" in res["reponse"]


def test_egalite_au_plus_bas_nomme_les_deux(monkeypatch):
    donnees = donnees_classement([agence("Agence A", 10, 3), agence("Agence B", 10, 3), agence("Agence C", 10, 9)])
    e = _installer(monkeypatch, donnees)
    e.reponses = ["Commentaire."]
    res = poser(QUESTION_FAIBLE)
    assert "Les agences Agence A, Agence B sont à égalité pour la satisfaction la plus faible : 30 % chacune." in res["reponse"]


def test_perimetre_restreint_a_une_agence_reste_inchange(monkeypatch):
    donnees = donnees_classement([agence("Agence Seule", 12, 6)], restreint=True)
    e = _installer(monkeypatch, donnees)
    e.reponses = ["Vous n'avez accès qu'à l'agence Agence Seule."]
    res = poser(QUESTION_FAIBLE, role=UserRole.AGENCY_MANAGER)
    assert len(e.llm_calls) == 1 and res["reponse"] == "Vous n'avez accès qu'à l'agence Agence Seule."


# ───────────────────────── 3. garde-fou numérique ─────────────────────────

@pytest.mark.parametrize("texte", [
    "Top 3 des agences",
    "Voici le top 5 du réseau.",
    "Les 3 premières agences du classement.",
    "Les 2 dernières agences.",
    "L'agence en 2e position, puis la 3e.",
    "L'agence au rang 2 et au rang 10.",
    "1er : Agence Nord",
    "1. Agence Nord\n2. Agence Sud\n3) Agence Est",
])
def test_nombres_de_structure_ne_declenchent_pas_l_avertissement(texte):
    assert verification.nombres_non_justifies(texte, set()) == []


@pytest.mark.parametrize("texte,attendu", [
    ("Top 3 des agences, dont 42 avis chez Nord.", ["42"]),
    ("Les 3 premières agences ont 17 % de plus.", ["17"]),
    ("Il y a 3 agences en difficulté.", ["3"]),
    ("Nord a 3 avis.", ["3"]),
    ("Le délai est de 48 h.", ["48"]),
])
def test_un_vrai_chiffre_non_retrouve_declenche_toujours(texte, attendu):
    assert verification.nombres_non_justifies(texte, set()) == attendu


def test_un_chiffre_retrouve_dans_les_donnees_ne_declenche_pas():
    assert verification.nombres_non_justifies("Nord a 3 avis.", {"3"}) == []


def test_top_3_dans_une_reponse_complete_sans_avertissement(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Top 3 des agences à suivre :\n1. Agence Nord\n2. Agence Sud"]
    res = poser(QUESTION_FAIBLE)
    assert "Vérification automatique" not in res["reponse"] and res["avertissements"] == []
    assert len(e.llm_calls) == 1  # pas de relance de correction pour un « Top 3 »


def test_chiffre_invente_declenche_l_avertissement_en_francais_clair(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Nord a perdu 47 clients ce mois-ci.", "Nord a perdu 47 clients quand même."]
    res = poser(QUESTION_FAIBLE)
    assert ("⚠ Vérification automatique : le chiffre 47 cité dans cette réponse n'a pas pu être confirmé par vos "
            "données. Ne vous y fiez pas.") in res["reponse"]
    assert res["avertissements"] == ["valeurs_non_verifiees: 47"]


def test_plusieurs_chiffres_inventes_message_au_pluriel(monkeypatch):
    e = _installer(monkeypatch, donnees_classement(DEUX_SUFFISANTES))
    e.reponses = ["Nord a perdu 47 clients et 91 points.", "Nord a perdu 47 clients et 91 points."]
    res = poser(QUESTION_FAIBLE)
    assert "les chiffres 47 ; 91 cités dans cette réponse n'ont pas pu être confirmés par vos données" in res["reponse"]


# ───────────────────────── 4. le seuil est celui du code existant ─────────────────────────

def test_le_seuil_de_volume_est_celui_de_queries():
    from app.agent import queries
    assert queries._SEUIL_VOLUME_FAIBLE == 5
    assert cas_reel()["seuil_volume_faible"] == 5
    assert classement.comparaison_possible(donnees_classement([agence("A", 5, 3), agence("B", 5, 4)]))
    assert not classement.comparaison_possible(donnees_classement([agence("A", 5, 3), agence("B", 4, 4)]))
