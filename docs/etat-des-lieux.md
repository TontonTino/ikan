# État des lieux — refonte du dashboard et du formulaire client

Document de référence de la refonte (lots 0 à 6). Chaque lot le lit avant de commencer et y note ce qu'il a tranché.

## Sources des jetons de design

Il n'existe **pas** de fichier de jetons partagé entre les applications. `shared/tokens.css` se présentait comme la
« source unique de vérité » mais n'était importé nulle part : il a été supprimé au lot 0.

| Application | Source réelle des jetons |
|---|---|
| Dashboard (`apps/dashboard`) | `src/styles/tokens.css` |
| Formulaire client (`apps/client`) | bloc `<style>` de `src/layouts/FeedbackLayout.astro` |

Le lot 2 aligne ces deux sources sur la même palette. Le bloc `<style>` de `apps/dashboard/index.html` ne sert qu'à
éviter un flash avant le chargement du CSS : il reprend la police et le fond de page des jetons, rien d'autre.

## Adresses des services

Aucune adresse de déploiement n'est codée dans le code (lot 0). Chaque application lit son environnement :

| Application | Variables | Sans la variable, en développement | Sans la variable, en production |
|---|---|---|---|
| API (`apps/api`) | `ALLOWED_ORIGINS` | origines `localhost` | refus de démarrer, message qui nomme la variable |
| Dashboard (`apps/dashboard`) | `VITE_API_URL`, `VITE_CLIENT_URL`, `VITE_AGENT_URL` | proxy `/api/v1`, `localhost:4321`, `localhost:8001` | le build s'arrête ; le serveur refuse de démarrer sans `VITE_API_URL` et `VITE_AGENT_URL` |
| Formulaire client (`apps/client`) | `PUBLIC_API_URL` | `http://localhost:8000/api/v1` | le build s'arrête ; le serveur refuse de démarrer |

Les valeurs attendues sont listées dans le `.env.example` de chaque application. Les adresses réelles ne
figurent que dans la configuration de déploiement (`render.yaml`, puis celle d'AWS) et dans la documentation.

## Palette retenue (lot 2)

Le corail porte l'action, le vert porte la marque et le statut « bon ». Détail des rôles et des contrastes dans
`apps/dashboard/src/styles/tokens.css` une fois le lot 2a fusionné.
