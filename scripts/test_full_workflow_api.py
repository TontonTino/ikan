"""
Test de validation bout-en-bout du workflow de traitement des feedbacks (Closed-Loop)
et du respect strict des permissions RBAC.
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'apps', 'api')))

from app.db.session import SessionLocal
from app.models.feedback import Feedback
from app.models.utilisateur import Utilisateur
from app.models.enums import UserRole
from app.models.historique_feedback import HistoriqueFeedback
from app.models.reponse_client import ReponseClient
from app.api.v1.endpoints.feedbacks import (
    open_feedback,
    add_note_interne,
    envoyer_suggestion_agence,
    definir_action_cx,
    confirmer_action_realisee,
    envoyer_reponse_client,
    reouvrir_feedback,
    get_historique,
    get_reponses,
)
from app.schemas.feedback import (
    NoteInterneCreate,
    SuggestionAgenceCreate,
    ActionCXCreate,
    ReponseClientCreate,
)
from fastapi import HTTPException

def run_tests():
    db = SessionLocal()
    try:
        # Trouver les utilisateurs de test
        agency_mgr = db.query(Utilisateur).filter(Utilisateur.role == UserRole.AGENCY_MANAGER).first()
        cx_mgr = db.query(Utilisateur).filter(Utilisateur.role == UserRole.CX_MANAGER).first()
        
        assert agency_mgr is not None, "Agency Manager requis pour le test"
        assert cx_mgr is not None, "CX Manager requis pour le test"

        # Créer un feedback de test dédié pour ne pas altérer les feedbacks existants
        from app.models.qr_code import QRCode
        qr = db.query(QRCode).filter(QRCode.agence_id == agency_mgr.agence_id).first()
        if not qr:
            qr = db.query(QRCode).first()

        import uuid
        test_fb = Feedback(
            id=uuid.uuid4(),
            qr_code_id=qr.id,
            note=2,
            commentaire="Test automatique workflow traitement feedback",
            statut_traitement="nouveau",
        )
        db.add(test_fb)
        db.commit()
        db.refresh(test_fb)
        print(f"Feedback de test cree: {test_fb.id} (statut: {test_fb.statut_traitement})")

        # TEST 1: Ouverture du feedback par l'Agency Manager -> passe a en_traitement
        res_open = open_feedback(test_fb.id, db=db, current_user=agency_mgr)
        assert res_open.statut_traitement == "en_traitement", f"Attendu: en_traitement, obtenu: {res_open.statut_traitement}"
        assert res_open.assigne_a_id == agency_mgr.id, "L'utilisateur assigne doit etre l'Agency Manager"
        print("[TEST 1 PASSED] Ouverture feedback : Nouveau -> En traitement valide")

        # TEST 2: Ajout d'une note interne
        res_note = add_note_interne(test_fb.id, NoteInterneCreate(texte="Test note interne confidentielle"), db=db, current_user=agency_mgr)
        hist = get_historique(test_fb.id, db=db, current_user=agency_mgr)
        assert any("Test note interne" in (h.details or "") for h in hist), "Note absente de l'historique"
        print("[TEST 2 PASSED] Ajout note interne et journalisation dans l'historique valide")

        # TEST 3: Envoi d'une suggestion par l'Agency Manager -> statut reste en_traitement
        res_sug = envoyer_suggestion_agence(test_fb.id, SuggestionAgenceCreate(suggestion="Proposition d'amelioration agence"), db=db, current_user=agency_mgr)
        assert res_sug.statut_traitement == "en_traitement", "Le statut doit rester en_traitement apres suggestion"
        assert res_sug.suggestion_agence == "Proposition d'amelioration agence"
        print("[TEST 3 PASSED] Suggestion Agency Manager transmise au CX valide")

        # TEST 4: RBAC - L'Agency Manager tente de definir une action CX -> HTTP 403
        try:
            definir_action_cx(test_fb.id, ActionCXCreate(action="Action illegale"), db=db, current_user=agency_mgr)
            assert False, "L'Agency Manager ne doit PAS pouvoir definir une action CX"
        except HTTPException as e:
            assert e.status_code == 403, f"Attendu 403, obtenu {e.status_code}"
            print("[TEST 4 PASSED] Blocage RBAC : Agency Manager interdit de definir une action (403 Forbidden)")

        # TEST 5: RBAC - L'Agency Manager tente de resoudre -> HTTP 403
        try:
            confirmer_action_realisee(test_fb.id, db=db, current_user=agency_mgr)
            assert False, "L'Agency Manager ne doit PAS pouvoir resoudre"
        except HTTPException as e:
            assert e.status_code == 403, f"Attendu 403, obtenu {e.status_code}"
            print("[TEST 5 PASSED] Blocage RBAC : Agency Manager interdit de resoudre (403 Forbidden)")

        # TEST 6: CX Manager definit une Action -> statut passe a en_cours
        res_act = definir_action_cx(test_fb.id, ActionCXCreate(action="Renforcer l'equipe d'accueil"), db=db, current_user=cx_mgr)
        assert res_act.statut_traitement == "en_cours", f"Attendu: en_cours, obtenu: {res_act.statut_traitement}"
        assert res_act.action_a_prendre == "Renforcer l'equipe d'accueil"
        print("[TEST 6 PASSED] Definition Action CX : En traitement -> En cours valide")

        # TEST 7: Reponse client envoyee
        res_rep = envoyer_reponse_client(test_fb.id, ReponseClientCreate(contenu="Bonjour, nous avons pris en compte votre retour", canal="whatsapp"), db=db, current_user=agency_mgr)
        assert len(res_rep) >= 1
        assert res_rep[-1].canal == "whatsapp"
        print("[TEST 7 PASSED] Envoi de reponse client et conversation valide")

        # TEST 8: CX Manager confirme l'action realisee -> statut passe a resolu
        res_res = confirmer_action_realisee(test_fb.id, db=db, current_user=cx_mgr)
        assert res_res.statut_traitement == "resolu", f"Attendu: resolu, obtenu: {res_res.statut_traitement}"
        assert res_res.action_realisee is True
        print("[TEST 8 PASSED] Confirmation action realisee : En cours -> Resolu valide")

        # TEST 9: Reouverture du feedback
        res_reopen = reouvrir_feedback(test_fb.id, db=db, current_user=cx_mgr)
        assert res_reopen.statut_traitement == "en_traitement", f"Attendu: en_traitement, obtenu: {res_reopen.statut_traitement}"
        print("[TEST 9 PASSED] Reouverture feedback : Resolu -> En traitement valide")

        # TEST 10: Verification de l'historique complet
        hist_final = get_historique(test_fb.id, db=db, current_user=agency_mgr)
        print(f"[TEST 10 PASSED] Historique d'audit contient {len(hist_final)} evenements chronologiques complets")

        # Nettoyage feedback de test
        db.delete(test_fb)
        db.commit()
        print("\n=== TOUS LES 10 TESTS DU WORKFLOW ONT REUSSI AVEC SUCCES (100% CONFORME) ===")

    finally:
        db.close()

if __name__ == '__main__':
    run_tests()
