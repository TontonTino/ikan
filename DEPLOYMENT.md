# 🌐 Guide de Déploiement & Tunnels Publics — IKAN AI

Ce guide explique comment exposer l'application **IKAN AI** sur Internet pour permettre le scan des **QR Codes** depuis n'importe quel smartphone (en 4G ou sur n'importe quel réseau Wi-Fi), ainsi que les étapes pour le déploiement final en production.

---

## 🛠️ 1. Mode Développement : Tunnel Public (Cloudflare Tunnel / ngrok)

En développement local, le formulaire client s'exécute par défaut sur `http://localhost:4321`. Un téléphone mobile connecté en 4G ne peut pas accéder directement au `localhost` de votre ordinateur.

### Option A : Cloudflare Tunnel (Recommandé — Gratuit & Sans compte requis)

1. **Installer Cloudflare Tunnel CLI (`cloudflared`)** :
   - **Windows** (via winget ou choco) : `winget install Cloudflare.cloudflared` ou téléchargez le binaire depuis [Cloudflare Releases](https://github.com/cloudflare/cloudflared/releases).
   - **macOS** : `brew install cloudflared`
   - **Linux** : `sudo apt install cloudflared`

2. **Lancer un tunnel pour le client Astro (port 4321)** :
   ```bash
   cloudflared tunnel --url http://localhost:4321
   ```
   L'outil va générer une URL HTTPS publique temporaire, par exemple :
   `https://ikan-client-sample.trycloudflare.com`

3. **Mettre à jour la variable d'environnement backend** :
   Dans le fichier `apps/api/.env`, modifiez la variable `PUBLIC_CLIENT_URL` avec l'URL HTTPS générée :
   ```env
   PUBLIC_CLIENT_URL=https://ikan-client-sample.trycloudflare.com
   ```

4. **Optionnel — Tunnel pour l'API Backend (port 8000)** :
   Si le client mobile a besoin de soumettre des avis directement à l'API via le tunnel public, lancez un second tunnel :
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
   Et mettez à jour `ALLOWED_ORIGINS` dans `apps/api/.env` pour autoriser l'origine du tunnel client.

---

### Option B : ngrok

1. **Installer ngrok** : `npm install -g ngrok` ou téléchargez l'exécutable sur [ngrok.com](https://ngrok.com).
2. **Lancer le tunnel client** :
   ```bash
   ngrok http 4321
   ```
3. **Mettre à jour `apps/api/.env`** avec l'URL HTTPS fournie par ngrok (ex: `https://xxxx.ngrok-free.app`) :
   ```env
   PUBLIC_CLIENT_URL=https://xxxx.ngrok-free.app
   ```

---

## 🚀 2. Mode Production (Déploiement définitif)

Pour la mise en production lors de l'Orange Summer Challenge ou le déploiement client :

### A. Backend FastAPI (`apps/api`)
* **Hébergeurs recommandés** : Railway, Render, Fly.io, ou serveur VPS (Ubuntu avec Docker + Nginx + Certbot).
* **Variables d'environnement requises** :
  ```env
  APP_ENV=production
  DEBUG=false
  DATABASE_URL=postgresql://user:password@host:5432/ikanai_prod
  SECRET_KEY=votre_cle_secrete_ultra_securisee
  ALLOWED_ORIGINS=https://feedback.votre-domaine.com,https://dashboard.votre-domaine.com
  PUBLIC_CLIENT_URL=https://feedback.votre-domaine.com
  ```

### B. Formulaire Client Astro (`apps/client`)
* **Hébergeurs recommandés** : Vercel, Netlify, Cloudflare Pages (déploiement ultra-rapide et gratuit).
* **HTTPS Obligatoire** : Le protocole HTTPS est **strictement obligatoire** pour permettre aux navigateurs mobiles d'accéder à la caméra pour scanner les QR codes.

### C. Dashboard React (`apps/dashboard`)
* **Hébergeurs recommandés** : Vercel, Netlify, Cloudflare Pages.

---

## 🔒 3. Recommandations de Sécurité
* Ne commitez jamais les clés secrètes (`SECRET_KEY`) ou mots de passe de base de données dans le système de version de code (Git).
* Assurez-vous que tous les conteneurs et tunnels utilisent des certificats SSL/TLS valides (HTTPS).
