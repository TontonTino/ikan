# IKAN AI - Service de Veille et Scraping Facebook

Microservice interne de veille et d'extraction automatisée (Playwright / FastAPI) pour extraire des publications, commentaires et avis depuis Facebook, normalisés pour le pipeline d'analyse IA (`FeedbackItem`, défini dans `scraping_service/base.py`).

La session Facebook est stockée localement dans `state/` : ce dossier contient les cookies de connexion et ne doit **jamais** être versionné ni partagé.

---

## 1. Installation et Environnement

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
```

> **Sécurité** : Utilisez impérativement un compte Facebook secondaire dédié au scraping. Ne jamais utiliser un compte personnel et ne jamais stocker de mots de passe en dur.

### Diagnostics et tests de l'environnement :

```powershell
# Diagnostic complet (configuration, session, connectivité Playwright)
python -m scripts.check_setup

# Validation unitaire du nettoyage de texte et des dates
python -m scripts.test_parser

# Suite de tests automatisés complète (15 tests)
pytest tests/ -v
```

---

## 2. Gestion de Session & Authentification

Facebook applique des contrôles de sécurité avancés (2FA, détection d'empreinte). La session est gérée de manière transparente :

### Inspection rapide de l'état local (sans ouvrir de navigateur, < 10ms) :
```powershell
python -m scraping_service.facebook.auth --status
```

### Connexion initiale ou renouvellement interactif :
```powershell
python -m scraping_service.facebook.auth
```
1. Un navigateur Chromium visible s'ouvre.
2. Connectez-vous avec les identifiants du compte de veille et validez la 2FA.
3. Appuyez sur `[ENTRÉE]` dans la console. Les cookies sont automatiquement validés et sauvegardés dans `state/facebook_storage_state.json`.

### Test de connexion en direct (headless) :
```powershell
python -m scraping_service.facebook.auth --check
```

---

## 3. Extraction CLI (Ligne de commande)

Le script CLI propose désormais des exports directs (JSON, CSV), la gestion des logs verbeux et la détection d'avis :

```powershell
# Extraction simple affichée dans le terminal
python scripts/scrape_facebook.py https://www.facebook.com/<nom_de_page> --max-items 20

# Export direct en JSON
python scripts/scrape_facebook.py https://www.facebook.com/<nom_de_page> --max-items 50 -o data/extract.json

# Export direct en CSV
python scripts/scrape_facebook.py https://www.facebook.com/<nom_de_page> --max-items 50 -o data/extract.csv --format csv

# Mode verbeux (logs DEBUG détaillés)
python scripts/scrape_facebook.py https://www.facebook.com/<nom_de_page> -v
```

---

## 4. API HTTP FastAPI

### Démarrage du serveur :
```powershell
# Générer une clé API sécurisée et la placer dans .env (VEILLE_API_KEY=...)
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Lancement du serveur uvicorn
uvicorn scraping_service.api:app --host 0.0.0.0 --port 8000
```

Documentation interactive Swagger disponible sur : `http://localhost:8000/docs`

### Endpoints disponibles :

| Méthode | Endpoint | Authentification | Description |
|---|---|---|---|
| `GET` | `/health` | Aucune | Santé du microservice et validité de session |
| `GET` | `/session/facebook/status` | Header `X-API-Key` | Inspection rapide des cookies enregistrés |
| `POST` | `/session/facebook/validate` | Header `X-API-Key` | Test actif de navigation en arrière-plan |
| `POST` | `/scrape/facebook` | Header `X-API-Key` | Extraction (corps JSON `{"target": "...", "max_items": 20}`) |
| `GET` | `/scrape/facebook` | Header `X-API-Key` | Extraction (paramètres d'URL pour compatibilité) |

#### Exemple d'appel POST :
```bash
curl -X POST "http://localhost:8000/scrape/facebook" \
  -H "X-API-Key: votre_cle_api" \
  -H "Content-Type: application/json" \
  -d '{"target": "https://www.facebook.com/example", "max_items": 25}'
```

---

## 5. Fonctionnalités Opérationnelles & Professionnelles

1. **Extraction Incrémentale Résiliente** : Résout la virtualisation DOM de Facebook (les posts précédents ne sont plus perdus lors du défilement infini).
2. **Isolation du Corps de Message** : Cible précisément le texte du post via les sélecteurs Comet (`data-ad-comet-preview="message"`) pour ne pas mélanger le post avec les commentaires sous-jacents.
3. **Protection Anti-Détection (Stealth)** : Masquage complet de `navigator.webdriver`, simulation de `window.chrome`, headers User-Agent réalistes et flags Blink anti-automatisation.
4. **Détection des Avis & Recommandations ("Avis")** :
   - Analyse automatique des recommandations : `rating: 5.0` (« recommande ») ou `rating: 1.0` (« ne recommande pas »).
   - Statut dans `metadata["recommendation"] = "recommended" | "not_recommended"`.
5. **Moteur de Dates Avancé** :
   - Prise en charge des dates relatives (FR & EN : « à l'instant », « 5 min », « 2 h », « hier à 14:30 », « 3 j »).
   - Prise en charge des dates absolues (« 15 septembre 2025 à 18:45 »).
   - Extraction des timestamps machines (`data-utime`, `datetime`, `aria-label`).
6. **Observabilité et Diagnostics Automatiques** :
   - Logging unifié horodaté (`scraping_service/core/logging.py`).
   - En cas d'erreur ou de flux vide (0 résultat), sauvegarde automatique d'un screenshot et d'un dump HTML dans `debug/screenshots/` et `debug/dumps/`.
7. **Support Proxy** : Configurable via `.env` (`VEILLE_PROXY_SERVER`, `VEILLE_PROXY_USERNAME`, `VEILLE_PROXY_PASSWORD`).
