# IKAN AI - Service de Veille & Collecte Multicanal

Service Python/FastAPI haute sécurité pour la collecte, la centralisation, la synchronisation continue et l'analyse intelligente des avis, publications et retours clients (Meta Graph API, Facebook Pages, et futures sources comme Google Reviews).

---

## 1. Vue d'ensemble & Architecture

Le module de veille IKAN AI permet aux entreprises et clients finaux de connecter leurs Pages officielles, d'extraire automatiquement leurs commentaires/publications sans perte, et d'enrichir chaque retour grâce à un pipeline IA de détection de sentiment et de catégorisation thématique.

```text
IKAN-AI-VEILLE/
├── scraping_service/            # Cœur applicatif et API REST
│   ├── ai/                      # Pipeline IA & analyse sémantique (sentiment, thème, confiance)
│   ├── core/                    # Crypto MultiFernet, stores fichiers sécurisés, jobs, OAuth anti-CSRF, logging
│   ├── facebook/                # Client Meta Graph API v21+, pagination, tokens, parser RGPD, collecteur unifié
│   ├── services/                # Synchronisation continue, cycle de vie des jetons & alertes
│   ├── api.py                   # Serveur FastAPI et routes REST
│   ├── base.py                  # Modèle universel FeedbackItem et contrat SourceScraper
│   └── config.py                # Gestion centralisée de la configuration VEILLE_*
├── scripts/                     # Outils d'administration et d'exécution CLI
│   ├── check_setup.py           # Diagnostic de l'environnement et de l'API Meta
│   ├── check_tokens.py          # Contrôle du cycle de vie des jetons de Pages
│   ├── exchange_dev_token.py    # Échange sécurisé de token Graph API Explorer
│   ├── rotate_encryption_key.py # Rotation à chaud des clés de chiffrement Fernet
│   ├── scrape_facebook.py       # Extraction manuelle et export JSON/CSV
│   └── run_scheduler.py         # Planificateur de synchronisation périodique
├── tests/                       # Suite de tests unitaires et d'intégration (100% isolée)
├── data/                        # Données collectées et exports (isolés par client)
├── state/                       # Stockage chiffré des pages et états de synchronisation
├── .env.example                 # Modèle de configuration sans aucun secret
└── requirements.txt             # Dépendances Python (FastAPI, Cryptography, Pydantic...)
```

---

## 2. Installation

### Prérequis
- Python 3.10 ou supérieur
- PowerShell (Windows) ou Bash (Linux/macOS)

### Initialisation de l'environnement

```powershell
# Cloner le projet et créer l'environnement virtuel
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1

# Mettre à jour pip et installer les dépendances
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# Initialiser le fichier de configuration local
Copy-Item .env.example .env
```

---

## 3. Configuration & Variables d'Environnement

Éditez le fichier `.env` à la racine (ce fichier est strictement ignoré par Git) :

| Variable | Description | Exemple / Défaut |
| :--- | :--- | :--- |
| `VEILLE_ENV` | Environnement (`dev` ou `production`). | `dev` |
| `VEILLE_API_KEY` | Clé d'API requise pour toutes les requêtes (en-tête `X-API-Key`). | Clé secrète alphanumérique |
| `VEILLE_FB_APP_ID` | Identifiant de votre App Meta. | `123456789012345` |
| `VEILLE_FB_APP_SECRET` | Secret de l'application Meta. | `secret_meta` |
| `VEILLE_FB_API_VERSION` | Version Meta Graph API ciblée. | `v21.0` |
| `VEILLE_FB_REDIRECT_URI` | URL de callback OAuth pour la connexion des clients. | `http://127.0.0.1:8001/connect/facebook/callback` |
| `VEILLE_TOKEN_ENCRYPTION_KEY` | Clé Fernet pour chiffrer les tokens au repos. | Généré via `Fernet.generate_key()` |
| `VEILLE_STATE_SECRET` | Clé secrète HMAC pour signer l'état OAuth anti-CSRF. | Secret aléatoire fort |
| `VEILLE_ALLOWED_RETURN_ORIGINS` | Origines autorisées pour la redirection post-OAuth. | `http://localhost:3000` |
| `VEILLE_CORS_ORIGINS` | Origines autorisées pour les requêtes web CORS. | `http://localhost:3000` |
| `VEILLE_SYNC_INTERVAL_MINUTES` | Intervalle de synchronisation en tâche de fond (0 = désactivé). | `60` |
| `VEILLE_TOKEN_CHECK_INTERVAL_HOURS` | Fréquence de contrôle de validité des jetons. | `6` |
| `VEILLE_ALERT_WEBHOOK_URL` | Webhook HTTP optionnel pour notifier les jetons expirés. | `https://api.ikan.ai/alerts` |

> [!TIP]
> Pour générer une clé de chiffrement valide :
> ```powershell
> python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```

---

## 4. Scripts d'Administration & CLI

### 1. Diagnostic de configuration
```powershell
python -m scripts.check_setup
```

### 2. Échange sécurisé de token développeur (sans exposition en clair)
Permet d'échanger un token utilisateur issu de Graph API Explorer contre un Page Access Token permanent, chiffré immédiatement :
```powershell
python -m scripts.exchange_dev_token
```

### 3. Contrôle du cycle de vie des jetons
Vérifie la validité de toutes les Pages connectées et alerte en cas d'expiration imminente :
```powershell
python -m scripts.check_tokens
```

### 4. Rotation à chaud de la clé de chiffrement Fernet
Rechiffre instantanément tous les jetons stockés avec une nouvelle clé primaire sans interruption :
```powershell
python -m scripts.rotate_encryption_key --new-key "NOUVELLE_CLE_FERNET"
```

### 5. Extraction ponctuelle vers fichier (CSV / JSON)
```powershell
python -m scripts.scrape_facebook --target "1360803493780902" --format csv
python -m scripts.scrape_facebook --target "1360803493780902" --format json --max-items 100
```

---

## 5. API REST FastAPI

### Démarrage du serveur

```powershell
python -m uvicorn scraping_service.api:app --reload --host 127.0.0.1 --port 8001
```

Documentation interactive Swagger : **http://127.0.0.1:8001/docs**

### Tableau des Endpoints

| Méthode | Route | Description | Auth requise |
| :--- | :--- | :--- | :---: |
| `GET` | `/health` | Diagnostic de santé et statut du service. | Non |
| `GET` | `/connect/facebook/start` | Démarre le flux OAuth Facebook sécurisé pour un client. | `X-API-Key` |
| `GET` | `/connect/facebook/callback`| Callback OAuth finalisant la liaison et le chiffrement du jeton. | Non (signé) |
| `GET` | `/pages` | Liste les Pages connectées d'un client (jetons masqués). | `X-API-Key` |
| `GET` | `/pages/{page_id}/reconnect-url`| Génère une URL de ré-authentification en cas d'expiration. | `X-API-Key` |
| `DELETE` | `/pages/{page_id}` | Révoque l'accès et supprime la Page du client. | `X-API-Key` |
| `POST` | `/pages/{page_id}/sync` | Déclenche la synchronisation immédiate d'une Page. | `X-API-Key` |
| `POST` | `/sync/run` | Synchronise l'ensemble des Pages actives du système. | `X-API-Key` |
| `GET` | `/feedback` | Récupère les retours collectés avec pagination par curseur. | `X-API-Key` |
| `POST` | `/ai/analyze` | Exécute l'analyse IA (sentiment, thématique, confiance). | `X-API-Key` |
| `GET` | `/jobs/history` | Historique et statistiques des jobs de collecte. | `X-API-Key` |

---

## 6. Pipeline d'Analyse IA

Chaque retour client collecté respecte le modèle standardisé `FeedbackItem` :

```json
{
  "source": "facebook",
  "source_id": "1360803493780902_122100450633496231",
  "target_url": "https://facebook.com/1360803493780902",
  "author_name": null,
  "author_hash": "a6c8e3f9...",
  "text": "Service client rapide, super équipe et très professionnel !",
  "rating": null,
  "published_at": "2026-10-06T20:00:00Z",
  "permalink": "https://www.facebook.com/1360803493780902/posts/122100450633496231",
  "sentiment": "positif",
  "theme": "service_client",
  "confidence": 0.90,
  "ai_analyzed_at": "2026-10-06T22:30:00Z",
  "metadata": {}
}
```

### Analyse sémantique à la demande : `POST /ai/analyze`
```json
// Requête
{
  "client_id": "mon_client_1",
  "limit": 50
}

// Réponse enrichie
{
  "client_id": "mon_client_1",
  "count": 2,
  "items": [
    {
      "source_id": "comm_1",
      "text": "Super support client, réponse rapide !",
      "sentiment": "positif",
      "theme": "service_client",
      "confidence": 0.90
    }
  ]
}
```

---

## 7. Sécurité & Conformité RGPD

1. **Zéro fuite de jeton :** Les tokens d'accès Meta ne sont jamais affichés en clair dans les logs, les retours d'API ou les terminaux grâce au filtre `TokenMaskingFilter` et au chiffrement MultiFernet.
2. **Confidentialité des auteurs (RGPD) :** Par défaut (`VEILLE_STORE_AUTHOR_NAME=False`), l'identité nominative des auteurs n'est pas stockée. Un hachage irréversible (`author_hash`) est généré pour permettre la déduplication sans compromettre la vie privée.
3. **Protection anti-CSRF / Anti-Replay :** Le flux OAuth utilise un `state` signé avec timestamp et nonce à usage unique, garantissant qu'aucune redirection malveillante ne peut injecter de token.
4. **Isolation multitenant stricte :** Les données de chaque client (`client_id`) sont stockées de façon hermétique avec validation stricte contre toute tentative de *Path Traversal*.

---

## 8. Exécution des Tests

Le projet intègre une suite de tests complète (54 tests unitaires et d'intégration), entièrement hermétique (aucune dépendance réseau requise) :

```powershell
python -m pytest -v
```

---

## 9. Intégration dans le Projet Principal IKAN AI

Pour monter directement ce module dans votre application FastAPI globale :

```python
from fastapi import FastAPI
from scraping_service.api import app as veille_app

app = FastAPI(title="IKAN AI Platform")

# Montage sous le préfixe /veille
app.mount("/veille", veille_app)
```
