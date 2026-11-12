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

## Palette retenue (lot 2a)

Un rôle fixe par couleur. Le corail porte l'action, le vert porte la marque et le statut « bon ».
Valeurs et contrastes dans `apps/dashboard/src/styles/tokens.css`, vérifiés par `src/styles/contraste.test.ts`.

| Jeton | Valeur | Rôle |
|---|---|---|
| `--color-encre` | #02302D | menu, titres, texte principal |
| `--color-text-2` | #5C7268 | texte secondaire |
| `--color-accent` | #C54825 | boutons et liens |
| `--color-accent-vif` | #E5603B | icônes et traits, jamais de texte |
| `--color-marque` | #3C7830 | logo et statut « bon » |
| `--color-citron` | #BCCF00 | graphiques et décor, jamais de texte |
| `--color-bg` | #F6F8F1 | fond de page |
| `--color-surface` | #FFFFFF | cartes et tableaux |
| `--color-border` | #7E8F84 | bordures de champs et de boutons |
| `--color-trait` | #D3DACA | séparateurs, contours de cartes |

Écarts au deck, décidés au lot 2a :

- **Accent** : le deck donne #C94A26. Un lien de cette couleur sur la crème ne fait que 4,37:1 (< 4,5). La variante
  conforme la plus proche, #C54825, sert à la fois aux boutons et aux liens (une seule couleur d'action).
- **Citron** : 1,74:1 sur blanc. Il ne peut porter aucun sens dans un graphique (seuil 3:1) : décor seulement.
- **Ajouts** : `--color-accent-hover` (#A63C1E, survol des boutons). La sélection réutilise le fond de statut neutre.

Typographie : Poppins auto-hébergée (`apps/dashboard/public/fonts`), 400 et 600 seulement ; échelle 12 / 14 / 15 / 18 / 22 / 28 px.
Les anciens noms (`--color-primary`, `--color-text-muted`, `--color-success-*`, `--weight-bold`…) restent, en alias vers ces
jetons : le lot 2b remplace leurs usages un groupe de fichiers à la fois.

## Formulaire client (lot 2c)

La feuille de `apps/client/src/pages/feedback/[code].astro` ne contient plus aucune couleur en dur : tout passe par les
jetons de `FeedbackLayout.astro` (mêmes valeurs que le dashboard, plus `--color-text-on-dark-muted`, `--shadow-card` et
`--shadow-dropdown`). `src/utils/accessibilite.test.mjs` résout ces jetons et vérifie chaque texte contre le fond lu dans la
feuille ; il échoue si une couleur en dur ou une graisse autre que 400/600 revient.

- En-tête encre plein ; « Envoyer » en accent (seul accent de l'écran) ; le reste en boutons à contour.
- Niveau choisi : contour encre de 2 px et fond neutre (la couleur ne porte pas seule la sélection).
- **Exception validée** : les 5 visages de note gardent leur échelle rouge → vert d'origine.
- Exceptions typographiques : 16 px dans les champs (zoom iOS), 12/13 px des libellés de niveaux (CL-07).
