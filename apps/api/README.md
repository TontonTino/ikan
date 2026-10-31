# apps/api — IKAN AI (backend FastAPI)

## Tests

```
pytest
```

### Vérifier la synchronisation modèles SQLAlchemy <-> migrations Alembic

`tests/test_schema_migrations_sync.py` compare le schéma déclaré par les modèles
(`Base.metadata`) à celui obtenu après un `alembic upgrade head` complet sur une base
**jetable** (jamais celle de `.env`) : un écart signale un modèle modifié sans migration
correspondante (ou l'inverse).

Sans base Postgres jetable, ce test est **skipped** (voir `test_migrations_head_correspondent_aux_modeles_postgres`)
et seule une limite connue est vérifiée sur SQLite (`test_migrations_head_sqlite_limite_connue`) :
plusieurs migrations historiques (ex. `002_organisation_fields`) exécutent du SQL brut
spécifique à PostgreSQL (`ALTER COLUMN ... SET NOT NULL`), que SQLite ne supporte pas — la
relecture complète de l'historique échoue donc sur SQLite, indépendamment de tout écart réel.

Pour lancer le VRAI test avec un Postgres jetable (Docker) :

```bash
docker run --rm -d --name ikan-schema-check -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:test@localhost:5433/postgres pytest tests/test_schema_migrations_sync.py -v
docker stop ikan-schema-check
```

## Créer le premier administrateur (toutes bases, y compris la production)

```bash
python scripts/creer_admin.py --email votre.adresse@exemple.org            # première fois
python scripts/creer_admin.py --email autre.admin@exemple.org --ajouter      # un administrateur existe déjà
```

Le mot de passe est demandé **deux fois, sans affichage** (terminal interactif obligatoire) ; il n'est jamais accepté en argument ni en variable d'environnement. Choisissez un mot de passe fort (12 caractères ou plus), unique, et ne l'écrivez pas dans le dépôt.
La commande refuse si l'e-mail existe déjà (sans modifier ce compte), si un administrateur existe déjà (sauf `--ajouter`) ou si le mot de passe ne respecte pas la règle. Elle écrit dans une seule transaction l'administrateur et, s'il n'en existe pas, l'organisation technique « Plateforme IKAN AI » à laquelle un compte doit être rattaché ; elle ne supprime et ne modifie rien d'autre, n'affiche jamais le mot de passe ni son hachage, et ne dépend pas de `APP_ENV`. Elle ne s'exécute jamais au démarrage de l'API.

## Base de développement (SD-02) : la production ne sert jamais en local

Les fichiers `.env` de ce poste (`apps/api/.env`, `apps/agent/.env`) ne doivent **jamais** contenir l'adresse de la base de production.
Un `.env` local qui pointe vers la production transforme chaque seed, chaque migration, chaque test mal réglé et chaque démarrage en
écriture sur les données réelles des clients. Création d'une base de développement :

1. Dans Supabase, créez un projet **séparé** nommé `ikanai-dev` (même région, offre gratuite suffisante). Ne partagez ni son mot de passe ni ses clés avec la production.
2. Récupérez l'adresse : *Project Settings → Database → Connection string → Session pooler* (port **5432**, pas 6543 : le mode transaction ne convient pas à Alembic ni aux outils comme `pg_dump`). Collez-la dans `DATABASE_URL` de `apps/api/.env` **et** de `apps/agent/.env` (l'agent lit la même instance que l'API).
3. Créez le schéma, une seule fois puis après chaque nouvelle migration : `cd apps/api && alembic upgrade head` (l'agent a la sienne : `cd apps/agent && alembic upgrade head`).
4. Si vous voulez des données fictives : `python seed.py` (base vide uniquement, voir plus bas).
5. Stripe : la clé locale est **toujours** `sk_test_...` (voir `.env.example`). Les clés réelles de la production (`sk_live_...`, base de production, secrets) n'existent que dans les variables d'environnement de Render (`render.yaml`), jamais sur un poste.

**Garde automatique.** `app/core/garde_production.py` contient la liste des identifiants de projet Supabase de production (publics : ce ne sont pas des secrets).
Dès que `DATABASE_URL` contient l'un d'eux, ces opérations s'arrêtent avec un message clair (sans afficher l'adresse ni le mot de passe), **avant** toute connexion :
tous les seeds et scripts de démonstration (`seed.py`, `scripts/seed_*.py`, `scripts/clear_demo_veille_urls.py`), `alembic upgrade`, le démarrage de l'API et celui de l'agent YAM, et la session de tests (qui refuse aussi toute connexion vers cette adresse).
Les tests de l'API tournent sur SQLite en mémoire : ils n'ont besoin d'aucune adresse.

- **Secrets locaux ≠ secrets de production.** `SECRET_KEY` (signature des jetons), `WEBHOOK_SECRET` (API → agent), `SSR_FORWARD_SECRET` (si vous l'utilisez) et les clés Stripe/Groq/WhatsApp/SMTP d'un `.env` local doivent être **différents** de ceux de Render : sinon un jeton de connexion fabriqué sur votre poste serait accepté par la production. Générez-les avec `python -c "import secrets; print(secrets.token_urlsafe(48))"` (au moins 32 caractères). La garde ne peut pas détecter une réutilisation (elle ne connaît pas la valeur de production et ne doit jamais la contenir) : **vérifiez-le vous-même dans le tableau de bord Render**. `SECRET_KEY` doit être identique dans `apps/api/.env` et `apps/agent/.env` (l'agent vérifie les jetons émis par l'API). Pour les envois réels : laissez `WHATSAPP_ACCESS_TOKEN` et `WHATSAPP_PHONE_NUMBER_ID` vides en local (l'agent ne peut alors rien envoyer), n'activez `MAIL_*` qu'avec un compte de test, gardez `sk_test_` pour Stripe.
- **Production (Render)** : avec `APP_ENV=production`, le démarrage et Alembic ne sont **jamais** bloqués (un test le prouve).
- **`scripts/creer_admin.py`** reste utilisable contre la production (c'est son but) : il n'est pas bloqué mais affiche un avertissement très visible, et garde ses propres garde-fous (terminal interactif, mot de passe jamais en argument, refus si un administrateur existe déjà sans `--ajouter`).
- **Intervention volontaire en production** (rare, à vos risques) : posez `IKAN_AUTORISER_PRODUCTION=oui` dans le terminal, pour une seule commande (`$env:IKAN_AUTORISER_PRODUCTION="oui"; python ...` sous PowerShell). La valeur exacte `oui` est exigée (`1`, `true`… ne suffisent pas). **Ne la mettez jamais dans un `.env`** (elle n'y a d'ailleurs aucun effet) ni dans la configuration de Render.
- Une nouvelle base de production ? Ajoutez son identifiant de projet à `IDENTIFIANTS_PROJETS_PRODUCTION` dans `app/core/garde_production.py` **et** dans `apps/agent/app/config/garde_production.py` (un test vérifie que les deux fichiers restent identiques).

## Données de démonstration (développement local uniquement)

Le démarrage de l'API **ne charge jamais de données** : il ne crée ni ne supprime d'utilisateurs, d'agences ni d'organisations.
Pour une base locale jetable, après `alembic upgrade head` :

```bash
python seed.py                          # base vide
python seed.py --confirmer-ecrasement   # base locale DÉJÀ remplie : efface d'abord ses données
```

Garde-fous : le seed refuse de s'exécuter si `APP_ENV` n'est pas `development` (donc en production, quel que soit le paramètre), et refuse si la
base contient déjà des utilisateurs, des agences ou des organisations sans `--confirmer-ecrasement`. Les comptes de démonstration utilisent le
mot de passe défini dans `seed.py` (jamais affiché) ; ne les créez jamais sur une base réelle.

## Schéma de la base : migrer PUIS démarrer (SD-03)

Le démarrage de l'API **ne modifie jamais la structure de la base** (aucun `ALTER`, `CREATE`, `DROP` ni `create_all()`, dans aucun
environnement). Le schéma ne vient que d'Alembic, toujours lancé **avant** l'API :

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT   # commande de démarrage Render (render.yaml)
```

Le `&&` empêche l'API de démarrer si la migration échoue : Render garde alors l'ancienne version en ligne. En local, lancez
`alembic upgrade head` une fois sur une base neuve (ou après chaque nouvelle migration), puis `uvicorn`. Une migration doit être additive
et idempotente (`IF NOT EXISTS`), avec `SET LOCAL lock_timeout = '5s'` quand elle prend un verrou.

## Variables d'environnement liées au schéma de la base

- `APP_ENV` (`development` par défaut ; déjà utilisée pour `COOKIE_SECURE` dans `auth.py`,
  réglée à `production` sur Render — voir `render.yaml`) contrôle aussi si `app/db/session.py` refuse de démarrer lorsque `DATABASE_URL`
  pointe vers un hôte Supabase connu (`*.supabase.co` ou `*.pooler.supabase.com`) alors que
  `APP_ENV != "development"` — ces hôtes sont une base de développement partagée, jamais
  la production.
