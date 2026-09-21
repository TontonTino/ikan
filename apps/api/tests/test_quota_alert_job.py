"""
Tests unitaires (logique pure, sans base réelle) du job d'alertes de quota.
La vérification bout-en-bout (email réellement envoyé, anti-spam en base)
a été faite manuellement avec un vrai SMTP — voir le rapport de la Phase 3.
"""
from datetime import date

from app.services import quota_alert_job as job


def test_debut_cycle_est_le_premier_jour_du_mois():
    d = job._debut_cycle()
    assert d.day == 1


def test_construire_email_seuil_100():
    sujet, corps = job._construire_email("Pharmacie Wend-Panga", "Feedbacks ce mois-ci", 20, 20, 100)
    assert "atteint" in sujet.lower()
    assert "Pharmacie Wend-Panga" in corps
    assert "20 / 20" in corps
    assert "100%" in corps


def test_construire_email_seuil_80():
    sujet, corps = job._construire_email("Pharmacie Wend-Panga", "Feedbacks ce mois-ci", 16, 20, 80)
    assert "bientôt" in sujet.lower()
    assert "80%" in corps


class _FakeQuery:
    def __init__(self, resultat):
        self._resultat = resultat

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._resultat

    def all(self):
        return self._resultat or []


class _FakeDb:
    def __init__(self, resultat=None):
        self.resultat = resultat
        self.added = []
        self.committed = False

    def query(self, *a, **k):
        return _FakeQuery(self.resultat)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True


def test_deja_envoyee_true_si_une_ligne_existe():
    db = _FakeDb(resultat=object())
    assert job._deja_envoyee(db, "org-1", "feedbacks", 80, date(2026, 9, 1)) is True


def test_deja_envoyee_false_si_aucune_ligne():
    db = _FakeDb(resultat=None)
    assert job._deja_envoyee(db, "org-1", "feedbacks", 80, date(2026, 9, 1)) is False


def test_traiter_organisation_ignore_metrique_illimitee(monkeypatch):
    org = type("Org", (), {"id": "org-1", "nom": "Test"})()
    monkeypatch.setattr(job, "utilisation_organisation", lambda db, org_id: {
        "plan": {"code": "starter", "nom": "Starter"},
        "feedbacks_ce_mois": {"actuel": 500, "max": None},  # illimité pour Starter
        "agences": {"actuel": 3, "max": 3},  # 100%, mais on va simuler deja_envoyee=True pour isoler ce test
        "cx_managers": {"actuel": 1, "max": 1},
    })
    monkeypatch.setattr(job, "_deja_envoyee", lambda *a, **k: True)  # tout deja envoye : ne doit rien declencher
    db = _FakeDb()
    job._traiter_organisation(db, org, date(2026, 9, 1))
    assert db.added == []


def test_traiter_organisation_sans_forfait_ignore(monkeypatch):
    org = type("Org", (), {"id": "org-1", "nom": "Test"})()
    monkeypatch.setattr(job, "utilisation_organisation", lambda db, org_id: {"plan": None})
    db = _FakeDb()
    job._traiter_organisation(db, org, date(2026, 9, 1))
    assert db.added == []


def test_traiter_organisation_envoie_et_enregistre_si_seuil_franchi(monkeypatch):
    org = type("Org", (), {"id": "org-1", "nom": "Pharmacie Test"})()
    monkeypatch.setattr(job, "utilisation_organisation", lambda db, org_id: {
        "plan": {"code": "gratuit", "nom": "Gratuit"},
        "feedbacks_ce_mois": {"actuel": 18, "max": 20},  # 90% -> seuil 80
        "agences": {"actuel": 1, "max": 1},  # 100% -> seuil 100
        "cx_managers": {"actuel": 1, "max": 1},  # 100% -> seuil 100
    })
    monkeypatch.setattr(job, "_deja_envoyee", lambda *a, **k: False)
    monkeypatch.setattr(job, "_destinataires_cx_manager", lambda db, org_id: ["cx@test.bf"])
    envois = []
    monkeypatch.setattr(job, "envoyer_email", lambda dest, sujet, corps: envois.append((dest, sujet)) or True)

    db = _FakeDb()
    job._traiter_organisation(db, org, date(2026, 9, 1))

    # 3 metriques toutes en seuil (feedbacks@80, agences@100, cx_managers@100)
    assert len(envois) == 3
    assert len(db.added) == 3
    assert db.committed is True


def test_traiter_organisation_ne_enregistre_pas_si_envoi_echoue(monkeypatch):
    org = type("Org", (), {"id": "org-1", "nom": "Pharmacie Test"})()
    monkeypatch.setattr(job, "utilisation_organisation", lambda db, org_id: {
        "plan": {"code": "gratuit", "nom": "Gratuit"},
        "feedbacks_ce_mois": {"actuel": 20, "max": 20},
        "agences": {"actuel": 1, "max": 1},
        "cx_managers": {"actuel": 1, "max": 1},
    })
    monkeypatch.setattr(job, "_deja_envoyee", lambda *a, **k: False)
    monkeypatch.setattr(job, "_destinataires_cx_manager", lambda db, org_id: ["cx@test.bf"])
    monkeypatch.setattr(job, "envoyer_email", lambda dest, sujet, corps: False)  # SMTP en echec

    db = _FakeDb()
    job._traiter_organisation(db, org, date(2026, 9, 1))

    # Aucun envoi reussi -> rien n'est enregistre (pour permettre un nouvel essai au prochain cycle)
    assert db.added == []
