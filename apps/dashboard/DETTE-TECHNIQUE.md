# Dette technique — Dashboard (refonte UI/UX)

Sujets identifiés pendant les étapes 1 à 4 de la refonte UI/UX, volontairement
**non traités côté frontend** : ils nécessitent une évolution backend ou des
données réelles. Le frontend n'en simule aucun (pas d'id, de date, de statut,
d'échéance ni d'impact inventés).

## 1. Contexte agence de YAM (sécurité)

**État actuel.** Les questions YAM contextuelles (dashboard CX : « À surveiller »,
« Pourquoi ? », panneau agence) contiennent le **nom** de l'agence en texte libre.
Aucun `agence_id` n'est transmis à `POST /agent/ask`. Le périmètre de données reste
celui du JWT de l'utilisateur.

**Règle d'architecture :**

```text
Le nom de l'agence fourni dans le prompt YAM
NE constitue JAMAIS une autorisation.
```

**Cible :**

```text
Session utilisateur → Agence autorisée → agence_id déterminé côté serveur → Contexte YAM
```

et jamais :

```text
Nom d'agence fourni par l'utilisateur → Autorisation
```

Référence code : `src/stores/yamStore.ts`, `src/pages/cx/siege/SiegeBlocks.tsx` (`AskYam`).
YAM analyse par ailleurs une fenêtre fixe de 30 jours (`services/agent.ts`), annoncée
explicitement dans les questions pré-remplies.

## 2. Modèle Alerte persistant

`GET /alertes` calcule les alertes de seuil comme un **état** (7 jours glissants,
≥ 3 avis, sous le seuil depuis 48 h pour le CX) : pas d'id, de date de création,
de statut, de prise en charge, de résolution ni d'historique. La page Alertes et la
cloche affichent donc « En cours » sans date pour ces alertes.

## 3. Modèle Action corrective unifié

Trois représentations coexistent :

- actions portées par un Feedback (`action_a_prendre`, `action_realisee`, `assigne_a_nom`) ;
- `ActionCorrective` des Issues (avec `responsable_id`, `echeance`, `statut`) ;
- brouillons d'action de l'agent YAM (`actions_agent`).

Cible métier : **Problème → Action → Responsable → Échéance → Réalisation → Impact.**
Conséquence actuelle : le bloc « Actions — toutes périodes » du dashboard CX affiche
des totaux non filtrés par période (l'API ne filtre que la date de soumission du
feedback), sans échéance ni impact.

## 4. Filtre par thème côté API

`GET /feedbacks/` n'accepte pas de filtre `theme` (ni criticité). Le paramètre
`?theme=` de la page Feedbacks filtre seulement les feedbacks déjà chargés (50 par
page). Le dashboard ne propose donc pas de lien « feedbacks de ce thème » : il
renvoie vers l'analyse des thèmes de Performance (agrégée côté serveur).

## 5. Mutualisation de `/alertes`

`GET /alertes` est appelé par le layout (cloche + badge du menu) **et** par le
dashboard CX. À mutualiser (store partagé ou cache de requêtes).

## 6. Calibration sur données réelles

Seuils **provisoires**, centralisés dans `src/pages/cx/siege/siegeData.ts` :

| Paramètre | Valeur | Constante |
|---|---|---|
| Baisse importante | −10 pts vs période précédente | `SURVEILLANCE.BAISSE_MIN_PTS` |
| Volume minimal pour signaler une baisse | ≥ 10 avis (période courante) | `SURVEILLANCE.BAISSE_MIN_AVIS` |
| Lignes « À surveiller » | 5 max | `SURVEILLANCE.MAX_LIGNES` |
| Faible volume d'un point de courbe | < 5 avis | `FAIBLE_VOLUME_POINT` |
| Comparaison à un seuil / classement Wilson | ≥ 3 avis | `MIN_AVIS_SEUIL` |

À calibrer sur données réelles. Le volume de la période précédente par agence
n'est pas exposé par `/statistics/cx` : le signal « baisse » ne peut pas le vérifier.

## 7. Anomalies API observées (non corrigées, backend hors périmètre)

- `_calc_kpi_trend` renvoie « +100% » quand la période précédente n'a aucun avis,
  y compris pour la satisfaction (écart en points suffixé « % ») : le frontend
  recalcule les deltas et n'affiche aucune comparaison dans ce cas.
- Tri lexical des semaines (« S10 » avant « S9 ») dans `/dashboard/siege` et
  `/statistics/cx` ; fusion possible de semaines de deux années sur 12 mois dans
  `/dashboard/siege`. Le frontend retrie les points de `/statistics/cx`.
- `evolution_taux_resolution` (`/dashboard/siege`) mesure la part de feedbacks non
  critiques, pas une résolution.
- Satisfaction renvoyée à `0.0` pour une agence/période sans avis : le frontend
  affiche « Pas d'avis ».
- Les « insights IA » de `/statistics/cx` sont des règles fixes, pas une analyse IA.

## 8. Seuils visuels préexistants hors dashboard CX

`components/stats/AgencesRankingTable.tsx` (Performance > Agences) colore la
satisfaction avec des seuils fixes 80/60 % (préexistants), indépendants du seuil
configuré de chaque agence. À aligner lors du traitement de la page Performance.
