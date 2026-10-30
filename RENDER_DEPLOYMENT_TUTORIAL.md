# 🚀 Tutoriel Pas-à-Pas : Déploiement d'IKAN AI sur Render (`render.com`)

> ⚠️ **Ce tutoriel est un document de démarrage historique, aujourd'hui dépassé par
> `render.yaml`** (Blueprint Render à la racine du repo), qui est la source de vérité
> réelle de l'infrastructure. Les URLs `*.onrender.com` de ce document sont des
> **exemples de la configuration initiale, pas les URLs actuelles** : le nom d'un
> service dans `render.yaml` (ex. `ikanai-api`) ne garantit PAS l'URL publique — si ce
> nom est déjà pris, Render en assigne un autre avec un suffixe aléatoire.
>
> **URLs de production réelles actuelles** (à vérifier dans le tableau de bord Render
> en cas de doute, jamais en devinant à partir d'un nom de service) :
> - API : `https://ikan-772d.onrender.com`
> - Client (QR codes) : `https://ikan-1.onrender.com`
> - Dashboard : `https://ikanai-dashboard-fixs.onrender.com`
> - Agent YAM : `https://yam-tpip.onrender.com`
>
> `https://ikanai-api.onrender.com` (nom du service dans `render.yaml`) est un
> **ancien service abandonné, base de données morte** — ne pas s'y fier.

Ce guide vous explique étape par étape comment déployer l'intégralité du projet **IKAN AI** en production sur Render, pour obtenir des URLs HTTPS permanentes 24h/24 et 7j/7 pour vos **QR Codes** et vos **Dashboards**.

---

## 📋 Structure globale du déploiement

Sur Render, nous allons créer 4 services :
1. **`ikanai-db`** : Base de données PostgreSQL (Managée par Render)
2. **`ikanai-api`** : Backend FastAPI (Web Service Python)
3. **`ikanai-client`** : Formulaire Client QR (Static Site / Node Service Astro)
4. **`ikanai-dashboard`** : Dashboard Admin / CX Manager (Static Site React)

---

## 🔑 Étape 0 : Préalables (GitHub)

1. Assurez-vous que tout votre code est commité et pushé sur un dépôt **GitHub** (public ou privé).
2. Créez un compte gratuit sur [render.com](https://render.com) et connectez votre compte GitHub.

---

## 🗄️ Étape 1 : Créer la Base de Données PostgreSQL (`ikanai-db`)

1. Connectez-vous à votre tableau de bord [Render Dashboard](https://dashboard.render.com).
2. Cliquez sur **New +** ➔ **PostgreSQL**.
3. Remplissez les champs :
   - **Name** : `ikanai-db`
   - **Database** : `ikanai`
   - **User** : `ikanai_user`
   - **Region** : Choisissez *Frankfurt (Europe)* pour la meilleure vitesse depuis l'Afrique / Europe.
   - **Plan** : *Free* (ou *Starter*).
4. Cliquez sur **Create Database**.
5. Une fois créée, copiez l'**Internal Database URL** (elle ressemble à `postgresql://ikanai_user:...@dpg-xxxx/ikanai`).

---

## ⚙️ Étape 2 : Déployer le Backend FastAPI (`ikanai-api`)

1. Dans le tableau de bord Render, cliquez sur **New +** ➔ **Web Service**.
2. Sélectionnez votre dépôt GitHub `ikanai`.
3. Configurez les options :
   - **Name** : `ikanai-api`
   - **Region** : *Frankfurt (Europe)*
   - **Root Directory** : `apps/api`
   - **Environment** : `Python 3`
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `uvicorn app.main:app --host 0.0.0.0 --port $PORT` *(Optimisé pour l'offre Free 512MB RAM)*
4. **Variables d'environnement (Environment Variables)** :
   Cliquez sur *Add Environment Variable* et ajoutez :
   - `DATABASE_URL` = *(Collez l'Internal Database URL de l'étape 1)*
   - `SECRET_KEY` = `ikanai-super-secret-key-orange-summer-challenge-2026-novax`
   - `APP_ENV` = `production`
   - `DEBUG` = `false`
   - `ALLOWED_ORIGINS` = `https://ikan-1.onrender.com,https://ikanai-dashboard-fixs.onrender.com` (URLs réelles du client et du dashboard ; ne pas y ajouter localhost en production)
   - `PUBLIC_CLIENT_URL` = `https://ikanai-client.onrender.com`
5. Cliquez sur **Create Web Service**.
6. Une fois déployé, vous obtenez l'URL de votre API : `https://ikanai-api.onrender.com`.

---

## 📱 Étape 3 : Déployer le Formulaire Client Astro (`ikanai-client`)

1. Cliquez sur **New +** ➔ **Static Site**.
2. Sélectionnez votre dépôt GitHub `ikanai`.
3. Configurez les options :
   - **Name** : `ikanai-client`
   - **Root Directory** : `apps/client`
   - **Build Command** : `npm install && npm run build`
   - **Publish Directory** : `dist`
4. **Variables d'environnement** :
   - `PUBLIC_API_URL` = `https://ikanai-api.onrender.com/api/v1`
5. Cliquez sur **Create Static Site**.
6. Vous obtenez l'URL finale des QR Codes : `https://ikanai-client.onrender.com`.

---

## 🖥️ Étape 4 : Déployer le Dashboard React (`ikanai-dashboard`)

1. Cliquez sur **New +** ➔ **Static Site**.
2. Sélectionnez votre dépôt GitHub `ikanai`.
3. Configurez les options :
   - **Name** : `ikanai-dashboard`
   - **Root Directory** : `apps/dashboard`
   - **Build Command** : `npm install && npm run build`
   - **Publish Directory** : `dist`
4. **Rewrite Rules (Pour le routage React SPA)** :
   Dans l'onglet **Redirects/Rewrites** du service sur Render :
   - Add Rule : Source `/*` ➔ Destination `/index.html` (Action: *Rewrite*).
5. Vous obtenez l'URL du Dashboard Admin : `https://ikanai-dashboard.onrender.com`.

---

## 🔄 Étape 5 : Migrations sur Render (pas de seed)

Les tables sont créées par `alembic upgrade head`, exécuté automatiquement à chaque déploiement (voir `startCommand` dans `render.yaml`).

**Ordre : migrer, puis démarrer.** La commande de démarrage est `alembic upgrade head && uvicorn …` : l'API ne démarre que si la migration a réussi (sinon Render garde l'ancienne version). Le démarrage de l'API ne modifie plus jamais la structure de la base (plus aucun `ALTER` ni `create_all`) : tout changement de schéma passe par une migration Alembic versionnée, additive et idempotente. Sur une base neuve (AWS comprise), `alembic upgrade head` suffit à produire le schéma complet.

⚠️ **Le seed de démonstration (`python seed.py`) est interdit en production** : il refuse de s'exécuter si `APP_ENV` n'est pas `development`, et l'API ne le lance plus jamais au démarrage. Les organisations, agences et comptes se créent depuis l'application, une fois le premier compte administrateur créé (ci-dessous).

### Créer le premier administrateur (une seule fois)

Sur une base neuve il n'existe aucun compte. Dans le **Shell** du service `ikanai-api` (onglet *Shell* sur Render, dossier `apps/api`) :

```bash
python scripts/creer_admin.py --email votre.adresse@exemple.org
```

La commande demande le mot de passe deux fois (sans affichage), puis affiche seulement `Compte administrateur créé : <e-mail>`. Pour ajouter un administrateur supplémentaire plus tard : même commande avec `--ajouter`.

⚠️ **Choisissez un mot de passe fort et unique** : 12 caractères ou plus, jamais utilisé ailleurs. Ne l'écrivez ni dans le dépôt, ni dans une variable d'environnement, ni dans une configuration Render, ni dans un message. La commande le demande deux fois, sans l'afficher, et refuse de le recevoir autrement (argument, variable, flux).

**Si l'onglet Shell n'est pas disponible** (il est réservé aux instances payantes ; le service de `render.yaml` est en `plan: free`) : soit passer temporairement le service en instance payante le temps de la commande, soit lancer la commande depuis un poste de confiance, dans un terminal dédié, en ne renseignant que l'adresse de la base (jamais le mot de passe de l'administrateur) :

```powershell
$env:DATABASE_URL = "<URL externe de la base Render, avec SSL>"
$env:SECRET_KEY = "valeur-quelconque-non-utilisee"
python scripts/creer_admin.py --email votre.adresse@exemple.org
```

Fermez ensuite le terminal (les variables disparaissent avec lui). La commande ne dépend pas de `APP_ENV`.

---

## ✅ Résultat Final

- 📱 **QR Codes Permanents** : Scannables 24h/24 en 4G sur `https://ikanai-client.onrender.com/feedback/QR-XXXXX`.
- 📊 **Dashboard Accessible** : Connectez-vous à tout moment sur `https://ikanai-dashboard.onrender.com`.
- 🔒 **HTTPS natif sans aucun avertissement de sécurité sur mobile**.
