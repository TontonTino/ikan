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
