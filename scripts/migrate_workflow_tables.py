"""
Migration de base de données pour ajouter le workflow Closed-Loop,
l'historique des feedbacks et les réponses clients dans PostgreSQL.
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'apps', 'api')))

from sqlalchemy import text
from app.db.session import engine, Base
import app.models  # Import all models

def run_migration():
    print("Application des tables et colonnes de workflow de traitement des feedbacks...")
    with engine.begin() as conn:
        # 1. Colonnes sur feedbacks
        conn.execute(text("""
            ALTER TABLE feedbacks 
            ADD COLUMN IF NOT EXISTS statut_traitement VARCHAR(50) DEFAULT 'nouveau',
            ADD COLUMN IF NOT EXISTS assigne_a_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS action_a_prendre TEXT,
            ADD COLUMN IF NOT EXISTS action_realisee BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS date_assignation TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS date_resolution TIMESTAMP WITH TIME ZONE,
            ADD COLUMN IF NOT EXISTS suggestion_agence TEXT,
            ADD COLUMN IF NOT EXISTS suggestion_agence_auteur VARCHAR(200),
            ADD COLUMN IF NOT EXISTS suggestion_agence_date TIMESTAMP WITH TIME ZONE;
        """))

        # 2. Table historique_feedbacks
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS historique_feedbacks (
                id UUID PRIMARY KEY,
                feedback_id UUID NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
                utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
                auteur_nom VARCHAR(200) NOT NULL,
                auteur_role VARCHAR(50) NOT NULL,
                agence_nom VARCHAR(200),
                type_evenement VARCHAR(100) NOT NULL,
                ancien_statut VARCHAR(50),
                nouveau_statut VARCHAR(50),
                details TEXT,
                date_evenement TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_hist_feedback_id ON historique_feedbacks(feedback_id);
            CREATE INDEX IF NOT EXISTS idx_hist_date_evenement ON historique_feedbacks(date_evenement DESC);
        """))

        # 3. Table reponses_clients
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS reponses_clients (
                id UUID PRIMARY KEY,
                feedback_id UUID NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
                utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
                auteur_nom VARCHAR(200) NOT NULL,
                auteur_role VARCHAR(50) NOT NULL,
                canal VARCHAR(50) NOT NULL DEFAULT 'telephone',
                contenu TEXT NOT NULL,
                date_envoi TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_reponses_feedback_id ON reponses_clients(feedback_id);
        """))

        # Initialiser statut_traitement à 'nouveau' pour les feedbacks NULL
        conn.execute(text("""
            UPDATE feedbacks SET statut_traitement = 'nouveau' WHERE statut_traitement IS NULL;
        """))

    print("Migration PostgreSQL terminée avec succès !")

if __name__ == '__main__':
    run_migration()
