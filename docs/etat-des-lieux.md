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

## Formulaire client : couleurs d'origine conservées

Décision du 13 novembre 2026 : le formulaire public (`apps/client`) garde ses couleurs d'origine (en-tête vert en dégradé,
visages colorés, boutons verts). La refonte ne le modifie pas. Ses contrastes restent vérifiés par
`apps/client/src/utils/accessibilite.test.mjs`.

## Une seule file d'avis et des périodes cohérentes (lot 3)

**File « À traiter »** — une seule règle, écrite côté serveur (`apps/api/app/services/dashboard_helpers.py`,
`est_a_traiter` / `condition_a_traiter_sql`) : demande de rappel en attente (même si l'avis est résolu), OU avis non résolu
noté 2 ou moins, au ton négatif, ou de gravité élevée ou critique. Un avis positif sans demande de rappel n'y entre jamais.
Changement d'API validé pour ce seul point ; statuts, clôture et calculs inchangés.

| Où | Ce qui s'affiche |
|---|---|
| Page Avis, onglet « À traiter » (`/feedbacks?filtre=a-traiter`) | la file, triée : sans prise en charge depuis plus de 48 h d'abord (trait `--color-accent-vif` à gauche, dit aussi aux lecteurs d'écran), puis du plus récent au plus ancien |
| Cloche | le nombre d'avis de la file et ses premiers avis (`utils/fileATraiter.ts`) ; plus d'alertes de seuil |
| Page Alertes | les alertes de seuil seulement, et un renvoi vers la file avec son compteur |
| Indicateur « Avis à traiter » de l'agence | la même règle, sur la période du tableau de bord |

L'onglet « À surveiller » est fusionné dans « À traiter » ; les anciens liens `tab=critiques` ouvrent la file.

**Périodes** — une seule liste (`apps/dashboard/src/utils/periodes.ts`) : 7 jours, 30 jours, 90 jours, 12 mois ; 30 jours par
défaut. « Aujourd'hui », « 14 jours » et « Cette année » disparaissent. Exception : la liste des avis garde « Toutes les dates »
par défaut (c'est une liste de travail, pas une statistique). Un bloc qui ne peut pas suivre la période de sa page l'écrit dans
son titre : « Agences sous leur seuil, 7 derniers jours », « Actions et problèmes, toutes dates confondues ».

**Classement des agences** — seule la satisfaction est affichée, suivie du nombre d'avis et d'une fiabilité en un mot
(faible < 10, moyenne 10 à 29, bonne ≥ 30). L'ordre reste celui de l'API (score de Wilson), expliqué en une phrase.

## Un seul nom par notion (lot 4)

Source unique : `apps/dashboard/src/utils/vocabulaire.ts`.

| Avant | Désormais |
|---|---|
| À surveiller, Avis à risque, Notifications (pour des avis) | Avis à traiter |
| Gravité, Criticité, Priorité (niveau) | Urgence : critique, élevée, normale (« normale » = faible ou moyenne en base ; filtre API `normale`) |
| Actions à mener, Recommandations | Actions ; une suggestion de YAM est une « action suggérée » |
| CX Manager | Responsable expérience client |
| Agency Manager, Responsable d'agence | Responsable d'agence |
| Important (urgence d'une alerte de seuil) | Élevée |

- « Alertes » reste le nom des agences sous leur seuil (page Alertes) : ce ne sont pas des avis.
- Le bloc « À surveiller » de la vue d'ensemble du réseau (des agences, pas des avis) s'appelle « Agences à suivre ».
- « Priorités » (bloc de l'accueil d'agence : ce qu'il faut regarder d'abord) n'est pas un niveau d'urgence et garde son nom.
- Les vues d'administration reçoivent parfois l'ancien libellé du rôle au lieu du code : `codeRole()` ramène les deux au code
  avant toute comparaison.
- Thèmes : un libellé par clé, majuscule initiale seulement, identique dans le dashboard (`utils/themeLabels.ts`), l'API
  (`THEME_LABELS_MAP`) et YAM (`_THEME_LABELS_VEILLE`) ; un test le vérifie. Les noms de catégorie saisis par les organisations
  sont affichés en majuscule initiale (`enMajusculeInitiale`) sans modifier la base.
- Vouvoiement partout, y compris les questions suggérées de YAM ; une seule mention « réponses générées automatiquement ».
- Titre de page = entrée de menu = fil d'Ariane.

## Formulaire client : un avis possible sans lire ni remplir (lot 5)

Couleurs du formulaire inchangées (décision du 13 novembre) ; seuls l'ordre, la catégorie, le téléphone et le retour changent.

- **Note d'abord.** La catégorie vient après, **facultative**, en boutons côte à côte (un par catégorie de
  `/qr-codes/{code}/categories`, nom tel que l'agence l'a écrit) et un bouton **« Autres »** qui laisse le champ vide.
  API : `categorie_id` facultatif à la création (la colonne était déjà nullable, aucune migration). Un avis sans catégorie a le
  thème « autre » à l'analyse (avant : « accueil », qui inventait une catégorie).
- **Débordement corrigé** : le filigrane de l'en-tête restait à `right: -30px`. Vérifié à 360 et 375 px sur les cinq écrans
  du parcours (`document.documentElement.scrollWidth` = largeur de la fenêtre), test de bout en bout à l'appui.
- **Téléphone** : indicatif « +226 » fixe devant le champ ; 8 chiffres acceptés avec ou sans espaces, affichés par deux
  pendant la saisie, envoyés au format international (`+22670123456`). `+226…`, `00226…` et les autres numéros
  internationaux restent acceptés (`utils/telephone.ts`).
- **Retour** sur l'écran de notation : même bouton, même place et même comportement que sur l'écran d'idée (retour à l'écran
  d'où l'on vient). Il n'apparaît pas quand il n'y a nulle part où revenir (QR scanné directement).

## Finitions (lot 6)

- **Connexion** : exemple d'adresse neutre (`prenom.nom@entreprise.com`, plus d'adresse tunisienne ; même correction sur la
  création d'organisation), champ mot de passe vide. « Mot de passe oublié ? » ouvre une boîte : l'API n'a pas de
  réinitialisation en libre-service (un administrateur redonne un mot de passe), elle dit donc qui contacter selon le rôle,
  avec l'adresse de l'équipe IKAN AI (`utils/contact.ts`, la même que « Obtenir de l'aide »). Aucune fausse page.
- **Gestion des agences** : « Modifier le responsable », « Modifier l'agence » ; « Désactiver l'agence » seule en bas de la
  fiche, après un trait et un espace, et toujours confirmée (la boîte nomme l'agence).
- **Demandes de rappel** :
  - en attente, l'ancienneté (« il y a 35 jours », sans bascule en date après 30 jours : le nombre de jours est
    l'information) ; date exacte au survol ;
  - plus de 48 h sans traitement : même marque que les avis en retard du lot 3 (trait à gauche) et la phrase « En attente
    depuis plus de 48 h » ;
  - numéro par groupes de deux (`+226 56 46 58 88`), lien `tel:` compact ;
  - sans consentement enregistré (ou refusé), ni numéro ni e-mail, ni bouton WhatsApp, et une phrase dit pourquoi. Même règle
    dans la fenêtre de traitement d'un avis. **Masquage d'affichage seulement** : l'API renvoie encore ces coordonnées ; les
    retirer de la réponse serait un changement d'API à décider.
- **Graphiques** : plus de numéros de semaine. L'API écrit la date du lundi (« 4 août », année ajoutée si la série couvre
  deux années) et les jours en clair (« 4 août ») ; infobulles « Semaine du 3 au 9 août 2026 ». Mois abrégés identiques à
  Intl fr-FR, dans l'API (`MOIS_COURTS_FR`) et le dashboard (`MOIS_COURTS`).
- **Carte du réseau** : les marqueurs proches à l'écran (moins de 44 px) se regroupent en une pastille numérotée, recalculée à
  chaque zoom ; un clic ou Entrée zoome sur le groupe. Un « ! » signale un groupe qui contient une agence sous son seuil, et le
  title détaille les statuts. Sans nouvelle dépendance (pas de leaflet.markercluster) : `components/map/regroupement.ts`.
