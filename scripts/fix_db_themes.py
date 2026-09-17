import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'apps', 'api')))

from app.db.session import SessionLocal
from app.models.feedback import Feedback
from app.models.analyse_ia import AnalyseIA
from app.services.ai.classification_service import classify
from app.services.ai.analyse_service import analyser_feedback

VALID_THEMES = [
    'attente', 'accueil', 'disponibilite_accessibilite', 'tarifs',
    'qualite_produit', 'proprete_cadre', 'application_mobile', 'reseau',
    'facturation', 'communication_information', 'livraison_logistique',
    'resolution_probleme', 'securite_confidentialite', 'disponibilite_produit',
    'personnalisation_besoin'
]

def run():
    db = SessionLocal()
    try:
        # 1. Analyser les feedbacks qui n'avaient pas d'analyse_ia
        feedbacks = db.query(Feedback).all()
        analyses = {a.feedback_id: a for a in db.query(AnalyseIA).all()}

        created_count = 0
        for fb in feedbacks:
            if fb.id not in analyses:
                print(f"Creation analyse pour feedback: {fb.id} (comm: '{fb.commentaire}')")
                analyser_feedback(fb.id, db=db)
                created_count += 1

        print(f"{created_count} feedbacks nouvellement analyses.")

        # 2. Re-classifier toute analyse dont le theme n'est pas strictement dans les 15 categories
        updated_count = 0
        all_analyses = db.query(AnalyseIA).all()
        for a in all_analyses:
            fb = db.query(Feedback).filter(Feedback.id == a.feedback_id).first()
            comm = fb.commentaire if fb else ''
            
            # Re-classifier si le theme est invalide ou "autre"
            if a.theme_principal not in VALID_THEMES:
                old_theme = a.theme_principal
                res = classify(comm or '')
                a.theme_principal = res['theme']
                print(f"Correction theme analyse {a.id}: {old_theme} -> {a.theme_principal} (verbatim: '{comm}')")
                updated_count += 1
            # Ou si c'est 'J’ai trop duré' qui était mal classé
            elif comm and 'dure' in comm.lower() and a.theme_principal != 'attente':
                old_theme = a.theme_principal
                res = classify(comm)
                a.theme_principal = res['theme']
                print(f"Re-classification attente: {old_theme} -> {a.theme_principal} (verbatim: '{comm}')")
                updated_count += 1

        db.commit()
        print(f"Termine : {updated_count} analyses mises a jour.")

        # Verification finale
        non_valid = [a for a in db.query(AnalyseIA).all() if a.theme_principal not in VALID_THEMES]
        print(f"Nombre d'analyses avec theme non valide: {len(non_valid)}")

    finally:
        db.close()

if __name__ == '__main__':
    run()
