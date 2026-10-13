"""
Journal des accès refusés (SD-10 / AM-01) : un événement JSON par 401/403, aucun 404, aucune donnée sensible.
"""
import json
import logging

import pytest

from tests._fixture_deux_agences import SECRET_A2, TEL_A2, construire_contexte

NOM = "ikan.security.access_denied"


@pytest.fixture()
def ctx():
    return construire_contexte()


def _evenements(caplog):
    return [json.loads(r.getMessage()) for r in caplog.records if r.name == NOM]


def test_403_d_un_am_sur_un_avis_d_une_autre_agence_produit_un_evenement(ctx, caplog):
    caplog.set_level(logging.INFO, logger=NOM)
    r = ctx.client.get(f"/feedbacks/{ctx.fb_a2}", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 403
    evts = _evenements(caplog)
    assert len(evts) == 1
    e = evts[0]
    assert e["evenement"] == "acces_refuse"
    assert e["utilisateur_id"] == str(ctx.am_a1)
    assert e["role"] == "agency_manager"
    assert e["methode"] == "GET"
    assert e["route"] == "/feedbacks/{feedback_id}"
    assert e["code"] == 403
    assert "hors de votre agence" in e["motif"]
    assert e["ip"] and e["horodatage"].endswith("+00:00")
    assert [rec.levelno for rec in caplog.records if rec.name == NOM] == [logging.WARNING]


def test_aucune_donnee_sensible_dans_le_journal(ctx, caplog):
    caplog.set_level(logging.INFO, logger=NOM)
    jeton = ctx.jeton(ctx.am_a1)
    r = ctx.client.post(
        f"/feedbacks/{ctx.fb_a2}/reponses-client?email=fuite@example.com&tel={TEL_A2}",
        headers={"Authorization": f"Bearer {jeton}"},
        json={"contenu": f"{SECRET_A2} rappelez le {TEL_A2} ou client@example.com", "canal": "telephone"},
    )
    assert r.status_code == 403
    texte = "\n".join(rec.getMessage() for rec in caplog.records if rec.name == NOM)
    assert texte, "un événement était attendu"
    for interdit in (jeton, "Bearer", SECRET_A2, TEL_A2, "client@example.com", "fuite@example.com", str(ctx.fb_a2),
                     "Motdepasse", "contenu", "email=", "tel="):
        assert interdit not in texte, f"champ interdit dans le journal : {interdit}"
    assert set(json.loads(texte)) == {"evenement", "horodatage", "utilisateur_id", "role", "methode", "route", "ip", "code", "motif"}


def test_401_est_journalise_sans_utilisateur(ctx, caplog):
    caplog.set_level(logging.INFO, logger=NOM)
    r = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers={"Authorization": "Bearer jeton-invalide-SECRET"})
    assert r.status_code == 401
    (e,) = _evenements(caplog)
    assert (e["code"], e["utilisateur_id"], e["role"], e["route"]) == (401, None, None, "/feedbacks/{feedback_id}")
    assert "jeton-invalide-SECRET" not in json.dumps(e)


def test_404_et_succes_ne_sont_pas_journalises(ctx, caplog):
    caplog.set_level(logging.INFO, logger=NOM)
    assert ctx.client.get("/route-inexistante", headers=ctx.H(ctx.am_a1)).status_code == 404
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert _evenements(caplog) == []


def test_la_reponse_envoyee_au_client_est_inchangee(ctx):
    r = ctx.client.get(f"/feedbacks/{ctx.fb_a2}", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 403 and r.json() == {"detail": "Accès refusé à ce feedback hors de votre agence"}


def test_un_403_de_garde_de_role_est_journalise_avec_l_utilisateur(ctx, caplog):
    caplog.set_level(logging.INFO, logger=NOM)
    r = ctx.client.get("/dashboard/siege", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 403
    (e,) = _evenements(caplog)
    assert (e["role"], e["route"]) == ("agency_manager", "/dashboard/siege")
