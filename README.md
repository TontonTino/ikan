# 🟢 IKAN AI — Plateforme SaaS de Collecte & Analyse de Feedback Client par QR Code

> **La voix du client, captée en agence, comprise au siège.**  
> *Projet développé dans le cadre de l'Orange Summer Challenge.*

---

## 🚀 Présentation du Projet

**IKAN AI** est une solution SaaS innovante permettant aux organisations à réseau d'agences (banques, télécoms, hôtellerie, restauration) de :
1. **Capturer les avis clients en temps réel** via un QR Code disponible sur borne/comptoir.
2. **Analyser automatiquement chaque feedback grâce à un moteur d'IA** (analyse de sentiment, classification thématique, criticité, détection des anomalies/discordances).
3. **Piloter l'expérience client à toutes les échelles** via des tableaux de bord interactifs dédiés aux Administrateurs, CX Managers (Siège) et Agency Managers.

---

## 🎨 Charte Visuelle & Identité de Marque

| Couleur | Code Hexa | Rôle Visuel |
|---|---|---|
| 🟢 **Midnight Green** | `#02302D` | Navigation principale & en-têtes contrastés |
| 🌿 **Forest Green** | `#3C7730` | Couleur primaire officielle & boutons principaux |
| 🍃 **Lime Accent** | `#75B72A` | Accents, survols & étoiles de satisfaction |
| ⚡ **Electric Lime** | `#BCCF00` | Indicateurs d'état & badges d'alerte |

---

## 🏗️ Architecture du Monorepo

```
ikanai/
├── apps/
│   ├── api/          # ⚙️ Backend FastAPI (Python 3.12, SQLModel/SQLAlchemy, PostgreSQL, JWT)
│   ├── client/       # 📱 Formulaire Client QR Mobile (Astro 5 + Node Adapter, <200KB)
│   └── dashboard/    # 🖥️ Back-Office Web Management (React 18 + Vite, Recharts, Leaflet)
├── DEPLOYMENT.md     # 📖 Guide de déploiement Cloudflare / Tunnels
└── RENDER_DEPLOYMENT_TUTORIAL.md # 🚀 Tutoriel pas-à-pas de déploiement Cloud Render
```

---

## ⚡ Stack Technique

### ⚙️ Backend (`apps/api`)
- **FastAPI** — Framework web asynchrone ultra-rapide.
- **PostgreSQL / SQLAlchemy** — Base de données relationnelle & ORM.
- **Alembic** — Gestion des migrations de schémas BDD.
- **Moteur d'IA Déterministe** — Sentiment analysis, classification thématique & détection des discordances.
- **Sécurité** — Auth JWT sécurisée, hashing Argon2 & RBAC strict (4 rôles).

### 📱 Client Mobile QR (`apps/client`)
- **Astro 5** — Chargement instantané (<3s) optimisé pour l'expérience mobile 4G.
- Formulaire réactif par étapes (Étoiles, Commentaire, Suggestions).

### 🖥️ Dashboard Management (`apps/dashboard`)
- **React 18 + Vite** — SPA fluide avec routage sécurisé par rôle.
- **Recharts & Leaflet** — Graphiques de tendances, répartition des sentiments & cartographie des agences.

---

## 👥 Rôles & Matrice des Droits (RBAC)

| Rôle | Périmètre & Accès |
|---|---|
| 🏛️ **Administrateur** | Gestion structurelle (Organisations, Utilisateurs, Paramètres Système, Matrice des droits). |
| 📊 **CX Manager (Siège)** | Vue d'ensemble de l'organisation, indicateurs agrégés, agences, alertes & recommandations globales. |
| 🏪 **Agency Manager** | Dashboard spécifique à son agence, feedbacks locaux, alertes & suggestions associées. |
| 📱 **Client** | Formulaire public anonyme d'évaluation par QR Code. |

---

## 🛠️ Installation & Démarrage Local

```bash
# 1. Cloner le projet
git clone https://github.com/jasstx/IKAN-AI.git
cd IKAN-AI

# 2. Lancer le Backend API
cd apps/api
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python run.py

# 3. Lancer le Dashboard React (dans un autre terminal)
cd apps/dashboard
npm install
npm run dev

# 4. Lancer le Client Astro (dans un autre terminal)
cd apps/client
npm install
npm run dev
```

---

## 🚀 Déploiement Cloud (Production Render)

Suivez le guide détaillé [`RENDER_DEPLOYMENT_TUTORIAL.md`](RENDER_DEPLOYMENT_TUTORIAL.md) pour déployer PostgreSQL, le Backend API, le Dashboard et le Client Astro sur [Render.com](https://render.com).

---

## 📝 Licence & Propriété

*Propriétaire — Orange Summer Challenge / Team NOVAX*
