# ikanai-agent

Service FastAPI **indépendant** portant l'agent IA conversationnel IKAN AI
(Q&A managers, brouillons d'action, alertes automatiques sur feedback
critique). Déployé séparément du backend principal (`apps/api`), sur son
propre port (8001), avec son propre `requirements.txt` et son propre
`.env` — mais connecté à la **même base PostgreSQL**.

Construit à partir du prototype `Agent IA/` (livré par Lionel, Chief AI
Officer) en remplaçant `mock_store` (données en mémoire) par de vraies
requêtes SQLAlchemy sur les tables du backend principal.

## Architecture

```
Backend principal (apps/api, port 8000)          ikanai-agent (port 8001)
──────────────────────────────────────           ──────────────────────────
analyse_service.py                                POST /webhook/analyse-complete
  → crée AnalyseIA                                  (secret partagé, PAS de JWT)
  → POST webhook  ───────────────────────────────►    → declencher_alerte_si_critique()
                                                        → génère un brouillon (table
                                                          actions_agent, propre à ce service)

Dashboard ──── Bearer JWT (même SECRET_KEY) ────►  POST /agent/ask
                                                    POST /agent/actions/brouillon
                                                    GET  /agent/actions
                                                    POST /agent/actions/{id}/valider
                                                    POST /agent/actions/{id}/rejeter
                                                          │
                                                          ▼
                                            même base PostgreSQL que apps/api
                                            LECTURE : feedbacks, analyses_ia, qr_codes,
                                                      agences, organisations, utilisateurs,
                                                      demandes_contact
                                            ÉCRITURE : actions_agent (uniquement)
```

- **Base de données partagée, schéma séparé de responsabilité** : ce
  service lit les tables du backend principal via des modèles SQLAlchemy
  en lecture seule (`app/models/readonly.py`, mappés sur un `Base` dédié,
  jamais géré par Alembic) et n'écrit que dans `actions_agent`, sa propre
  table, gérée par sa propre migration (`alembic/versions/001_action_agent.py`).
- **Auth** : ce service n'émet jamais de JWT (pas de `/login`). Il
  **vérifie** les tokens émis par le backend principal, avec la même
  `SECRET_KEY`/`ALGORITHM` — voir `app/api/deps.py`, calqué sur
  `apps/api/app/api/deps.py`.
- **Webhook** : le backend principal doit appeler
  `POST /webhook/analyse-complete` juste après avoir créé une `AnalyseIA`.
  Protégé par un header `X-Webhook-Secret` comparé à `WEBHOOK_SECRET`
  (comparaison à temps constant), pas par JWT — c'est un appel
  service-à-service.

## Personnalité affichée : YAM

Côté utilisateur, l'agent se présente comme **YAM** (prompts système et
messages d'erreur/refus générés par l'agent). Le nom technique du service
reste `ikanai-agent`.

## Isolation multi-organisation (sécurité — ne pas contourner)

Chaque appel `/agent/*` est cantonné à l'organisation de l'utilisateur
connecté :

- L'`organisation_id` vient **toujours** de `current_user.organisation_id`
  (JWT vérifié, utilisateur relu en base) — jamais du corps de la requête.
- Toute fonction de `app/agent/queries.py` exige `organisation_id`
  (paramètre obligatoire, refus si `None`) et filtre `Agence.organisation_id`.
- `agence_id` fourni → vérifié comme appartenant à l'organisation **avant**
  toute requête ; sinon **404** (indistinguable d'une agence inexistante,
  pour ne rien révéler des autres organisations).
- Actions (`GET /agent/actions`, `valider`, `rejeter`, `brouillon`) : filtrées
  par `action → feedback → agence → organisation` ; hors périmètre → 404, sans
  aucun effet de bord.
- Conversations : rechargées uniquement si `conversation_id` **et**
  `utilisateur_id` correspondent ; sinon une nouvelle conversation est créée.
- Le webhook (service-à-service, sans JWT) déduit l'organisation du feedback.

Tests d'isolation (Postgres de test **local**, jamais la prod) :

```bash
# base locale dont le nom contient « test » ; son schéma public est RECRÉÉ
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/ikanai_test python -m pytest
```

## Installation

```bash
cd ikanai-agent
pip install -r requirements.txt
cp .env.example .env
# Renseigner DATABASE_URL (identique à apps/api/.env), SECRET_KEY (identique
# à apps/api/.env), WEBHOOK_SECRET, GROQ_API_KEY (https://console.groq.com/keys), WHATSAPP_*
alembic upgrade head   # crée uniquement la table actions_agent
uvicorn app.main:app --reload --port 8001
```

## Endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/agent/ask` | Bearer JWT (CX/Agency Manager/Admin) | Q&A conversationnel |
| GET | `/agent/proactive-summary?jours=7` | Bearer JWT | Analyse proactive (`{insight, niveau, actions}`), limitée à l'organisation (et à l'agence pour un Agency Manager) |
| POST | `/agent/actions/brouillon` | Bearer JWT | Génère un brouillon manuellement |
| GET | `/agent/actions` | Bearer JWT | Liste des brouillons `EN_ATTENTE` |
| POST | `/agent/actions/{id}/valider` | Bearer JWT | Valide + tente l'envoi WhatsApp en tâche de fond |
| POST | `/agent/actions/{id}/rejeter` | Bearer JWT | Rejette un brouillon |
| POST | `/webhook/analyse-complete` | `X-Webhook-Secret` | Appelé par le backend principal |

Contrat `POST /agent/ask` :
```json
// Requête
{"question": "Y a-t-il des alertes critiques ?", "agence_id": "uuid-ou-absent", "jours": 7}
// Réponse
{"intention": "alertes_critiques", "reponse": "texte généré par YAM (Groq)", "donnees": [...]}
```
`agence_id` doit être un UUID valide ou **absent** du JSON — jamais `""`.

## Décisions prises en s'écartant du prototype (et pourquoi)

1. **`necessite_verification` n'existe pas dans `AnalyseIA` côté backend
   principal** (vérifié : absent du modèle SQLAlchemy et de la migration
   Alembic initiale — voir audit préalable). Ce champ est donc **dérivé**
   de `discordance_detectee` (note client incohérente avec le sentiment
   détecté), le signal réel le plus proche conceptuellement. Voir la note
   en tête de `app/agent/queries.py`. Si le backend principal ajoute un
   jour une vraie colonne `necessite_verification`, il suffit de modifier
   `_ligne_vers_dict()` dans ce fichier.

2. **`intent_classifier.py` est un moteur à mots-clés déterministe**, pas
   le zero-shot Hugging Face du prototype (`nlp_provider.py`). Le
   `GUIDE_INTEGRATION.md` du prototype indique explicitement que
   `nlp_provider.py` est *"NON UTILISÉ en prod, conservé comme
   référence"* — cette version suit donc la même logique que le reste du
   pipeline IKAN AI (`sentiment.py` / `classification_service.py` côté
   backend principal sont eux aussi 100% lexicaux, sans dépendance
   réseau). `HF_API_KEY` reste dans la configuration si cette approche
   devait être remplacée par le modèle zero-shot plus tard.

3. **L'envoi WhatsApp est découplé de la validation.**
   `action_service.valider_action()` ne fait plus qu'un `UPDATE` DB
   synchrone. `action_service.envoyer_whatsapp_si_applicable()` est une
   fonction séparée, destinée à `BackgroundTasks`, qui ouvre **sa propre
   session DB** (`SessionLocal()`) — la session de la requête HTTP
   d'origine est fermée avant qu'une tâche de fond ne s'exécute.

4. **`declencher_alerte_si_critique()` est idempotent** : si un brouillon
   `REPONSE_CLIENT` existe déjà pour un `feedback_id` donné, il est
   retourné tel quel plutôt que dupliqué. Nécessaire car un webhook HTTP
   peut être appelé plusieurs fois (retry réseau côté backend principal).

5. **`SECRET_KEY`/`DATABASE_URL`/`WEBHOOK_SECRET` n'ont pas de valeur par
   défaut** dans `app/config/settings.py` — le service refuse de démarrer
   sans `.env` correctement rempli, plutôt que de retomber sur une valeur
   hardcodée (contrairement à `apps/api/app/core/config.py` qui a un
   `DATABASE_URL` par défaut pointant vers une vraie instance Render — à
   corriger côté backend principal, hors périmètre de ce projet).

## Côté backend principal (apps/api) : appel du webhook

`apps/api/app/services/ai/analyse_service.py` appelle
`POST {AGENT_WEBHOOK_URL}/webhook/analyse-complete` juste après le `commit`
d'une analyse de criticité `elevee`/`critique` (`_notifier_agent()`).
L'appel est **fail-safe** : timeout court, toute erreur est journalisée puis
ignorée — l'enregistrement du feedback et de son analyse n'en dépend jamais.
Configuration dans `apps/api/.env` : `AGENT_WEBHOOK_URL` (URL de base, ex.
`http://localhost:8001` ; vide = désactivé) et `WEBHOOK_SECRET` (identique à
celui d'`ikanai-agent/.env`).

## Limites connues / suite possible

- Aucun test automatisé n'a encore été porté depuis `tests/test_agent.py`
  du prototype (ils mockaient `mock_store` et les providers ; à réécrire
  avec une base de test ou des fixtures SQLAlchemy).
- Le classifieur d'intention par mots-clés est une base fonctionnelle,
  pas calibrée sur des données réelles — à affiner une fois des questions
  réelles de managers observées.
