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

## Variables d'environnement liées au schéma de la base

- `ENVIRONMENT` (`development` par défaut) : contrôle si `app/main.py` exécute
  `Base.metadata.create_all()` au démarrage (uniquement en `development` — en production, le
  schéma ne vient que de `alembic upgrade head`, déjà dans la commande de démarrage Render) et
  si `app/db/session.py` refuse de démarrer lorsque `DATABASE_URL` pointe vers un hôte Supabase
  connu (`*.supabase.co` ou `*.pooler.supabase.com`) alors que `ENVIRONMENT != "development"` —
  ces hôtes sont une base de développement partagée, jamais la production.
- Distincte d'`APP_ENV` (préexistante, utilisée ailleurs) : Render doit définir **les deux**
  (voir `render.yaml`).
