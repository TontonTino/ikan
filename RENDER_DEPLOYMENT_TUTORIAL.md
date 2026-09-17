# 🚀 Tutoriel Pas-à-Pas : Déploiement d'IKAN AI sur Render (`render.com`)

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
   - `ALLOWED_ORIGINS` = `https://ikanai-client.onrender.com,https://ikanai-dashboard.onrender.com`
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

## 🔄 Étape 5 : Exécuter le Seed & les Migrations sur Render

Pour créer les données initiales et les tables sur la base PostgreSQL Render :

Connectez-vous à la console Shell de votre Web Service Backend (`ikanai-api`) sur Render et lancez :
```bash
python seed.py
```
Toutes vos organisations, agences et comptes utilisateurs seront créés en BDD avec leurs QR Codes HTTPS permanents !

---

## ✅ Résultat Final

- 📱 **QR Codes Permanents** : Scannables 24h/24 en 4G sur `https://ikanai-client.onrender.com/feedback/QR-XXXXX`.
- 📊 **Dashboard Accessible** : Connectez-vous à tout moment sur `https://ikanai-dashboard.onrender.com`.
- 🔒 **HTTPS natif sans aucun avertissement de sécurité sur mobile**.
