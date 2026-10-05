"""
Minimisation des données personnelles envoyées au LLM (5B-1).

Tests UNITAIRES sans base de données (contrairement à tests/, qui exige un PostgreSQL de
test via TEST_DATABASE_URL) : ils tournent partout, y compris en CI sans base.

  python -m pytest tests_unit
"""
import ast
import os
from pathlib import Path

# Valeurs factices de test (aucun accès réseau ni base : seule la construction du prompt est testée).
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")  # jamais connectée
os.environ.setdefault("SECRET_KEY", "test-secret-key-minimisation-0123456789abcdef")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-minimisation")

from app.agent.minimisation import CHAMPS_EXCLUS_DU_LLM, pour_llm  # noqa: E402

AGENT_DIR = Path(__file__).resolve().parents[1] / "app" / "agent"


def _feedback(telephone="+33600000000"):
    return {"id": "f1", "commentaire": "Attente trop longue", "agence_nom": "A1", "contact_telephone": telephone}


def test_le_telephone_client_est_retire():
    assert "contact_telephone" in CHAMPS_EXCLUS_DU_LLM
    assert "contact_telephone" not in pour_llm(_feedback())


def test_retrait_recursif_listes_et_dicts_imbriques():
    donnees = {"alertes": [_feedback(), _feedback("+33611111111")], "resume": {"top": _feedback()}}
    nettoye = pour_llm(donnees)
    texte = repr(nettoye)
    assert "+33600000000" not in texte and "+33611111111" not in texte
    # Le reste du contexte utile à la réponse est conservé
    assert nettoye["alertes"][0]["commentaire"] == "Attente trop longue"
    assert nettoye["resume"]["top"]["agence_nom"] == "A1"


def test_l_objet_d_origine_n_est_pas_modifie():
    # La réponse et l'envoi WhatsApp utilisent toujours les données d'origine.
    original = _feedback()
    pour_llm(original)
    assert original["contact_telephone"] == "+33600000000"


def _appels_json_dumps_non_filtres(fichier: Path) -> list[int]:
    """Lignes où json.dumps(...) est appelé sans que son 1er argument soit pour_llm(...)."""
    arbre = ast.parse(fichier.read_text(encoding="utf-8"))
    lignes = []
    for noeud in ast.walk(arbre):
        if (
            isinstance(noeud, ast.Call)
            and isinstance(noeud.func, ast.Attribute)
            and noeud.func.attr == "dumps"
            and isinstance(noeud.func.value, ast.Name)
            and noeud.func.value.id == "json"
        ):
            premier = noeud.args[0] if noeud.args else None
            filtre = isinstance(premier, ast.Call) and isinstance(premier.func, ast.Name) and premier.func.id == "pour_llm"
            if not filtre:
                lignes.append(noeud.lineno)
    return lignes


def test_tout_json_envoye_au_llm_passe_par_pour_llm():
    """Garde-fou : tout futur json.dumps ajouté à un module qui construit des prompts
    doit filtrer les données personnelles."""
    for nom in ("qa_service.py", "action_service.py"):
        assert _appels_json_dumps_non_filtres(AGENT_DIR / nom) == [], f"json.dumps non filtré dans {nom}"


def test_le_brouillon_d_action_n_envoie_pas_le_telephone():
    from app.agent.action_service import _build_user_prompt

    prompt = _build_user_prompt(_feedback())
    assert "+33600000000" not in prompt
    assert "Attente trop longue" in prompt
