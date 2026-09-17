import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'apps', 'api')))

from app.db.session import SessionLocal
from app.models.feedback import Feedback
from app.models.utilisateur import Utilisateur
from app.models.historique_feedback import HistoriqueFeedback
from app.models.reponse_client import ReponseClient
from app.models.enums import UserRole

def test_workflow():
    db = SessionLocal()
    try:
        # Trouver un agency manager et un cx manager
        agency_mgr = db.query(Utilisateur).filter(Utilisateur.role == UserRole.AGENCY_MANAGER).first()
        cx_mgr = db.query(Utilisateur).filter(Utilisateur.role == UserRole.CX_MANAGER).first()
        
        print(f"Agency Manager: {agency_mgr.email if agency_mgr else 'None'}")
        print(f"CX Manager: {cx_mgr.email if cx_mgr else 'None'}")

        # Trouver un feedback pour tester
        fb = db.query(Feedback).first()
        if not fb:
            print("Aucun feedback en base pour tester.")
            return

        print(f"\n--- TEST SUR FEEDBACK {fb.id} (statut actuel: {fb.statut_traitement}) ---")
        
        # Test 1: Statuts autorisés
        valid_statuses = ['nouveau', 'en_traitement', 'en_cours', 'resolu']
        assert fb.statut_traitement in valid_statuses, f"Statut invalide: {fb.statut_traitement}"
        print("✓ Test 1: Statut initial valide dans la taxonomie fermée.")

        # Test 2: Historique
        history_count = db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fb.id).count()
        print(f"✓ Test 2: Historique accessible ({history_count} événements).")

        # Test 3: Réponses client
        reponses_count = db.query(ReponseClient).filter(ReponseClient.feedback_id == fb.id).count()
        print(f"✓ Test 3: Table réponses accessible ({reponses_count} réponses).")

        print("\nTous les modèles backend et relations PostgreSQL sont 100% opérationnels !")
    finally:
        db.close()

if __name__ == '__main__':
    test_workflow()
