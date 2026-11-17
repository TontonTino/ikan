# Déploiement automatique sur EC2

Après chaque fusion sur `main`, GitHub lance les tests. S'ils sont verts, il demande à AWS d'exécuter
`scripts/deployer-ec2.sh` sur le serveur. Ce script met à jour le code, construit le formulaire et le dashboard,
publie le dashboard et relance les services. Le compte rendu s'affiche dans l'onglet **Actions** de GitHub.

```
Fusion sur main → Tests (GitHub) → Déployer (GitHub → AWS SSM → serveur EC2)
```

Le passage par **AWS Systems Manager (SSM)** évite d'ouvrir le port SSH du serveur à Internet.

## Ce qui tourne sur le serveur (relevé du 16/11/2026)

| Élément | Où | Relancé par |
|---|---|---|
| API | `/home/ec2-user/ikan/apps/api` (`.venv`, Python 3.11) | `systemctl restart ikan-api` |
| YAM | `/home/ec2-user/ikan/apps/agent` | `systemctl restart ikan-agent` |
| Veille | `/home/ec2-user/ikan/apps/veille` | `systemctl restart ikan-veille` |
| Formulaire client | `/home/ec2-user/ikan/apps/client` (Node 20 via nvm) | `systemctl restart ikan-client` |
| Dashboard | fichiers statiques dans `/var/www/ikan-dashboard` | rien (servi tel quel) |
| Site vitrine | `ikan-site-api`, `/var/www/ikan-site` | **jamais touché** par ce déploiement |

## Mise en place (une seule fois)

### 1. Le serveur doit être joignable par SSM
Dans la console AWS, ouvrez **Systems Manager → Fleet Manager** (ou *Nœuds gérés*).
- Si le serveur y apparaît **en ligne**, passez à l'étape 2.
- Sinon, sur la page de l'instance EC2, utilisez **Actions → Sécurité → Modifier le rôle IAM** et attachez un rôle
  qui contient la stratégie **AmazonSSMManagedInstanceCore**. Après quelques minutes, le serveur apparaît dans Fleet Manager.

### 2. Un utilisateur IAM réservé à GitHub
Dans **IAM → Utilisateurs → Créer un utilisateur**, nommez-le `github-deploiement`, sans accès à la console.
Ajoutez-lui cette stratégie en ligne, en remplaçant `REGION`, `COMPTE` et `INSTANCE` par vos valeurs.
Elle ne permet **que** de lancer une commande sur ce serveur et d'en lire le résultat.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:REGION:COMPTE:instance/INSTANCE",
        "arn:aws:ssm:REGION::document/AWS-RunShellScript"
      ]
    },
    { "Effect": "Allow", "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], "Resource": "*" }
  ]
}
```

Créez ensuite une **clé d'accès** pour cet utilisateur (type « Application exécutée en dehors d'AWS »).

### 3. Les secrets dans GitHub
Dans le dépôt, ouvrez **Settings → Secrets and variables → Actions → New repository secret**, et créez ces 4 secrets :

| Nom | Valeur |
|---|---|
| `AWS_ACCESS_KEY_ID` | la clé d'accès de l'étape 2 |
| `AWS_SECRET_ACCESS_KEY` | son secret |
| `AWS_REGION` | la région du serveur (ex. `eu-west-3`) |
| `EC2_INSTANCE_ID` | l'identifiant de l'instance (ex. `i-0abc…`) |

### 4. Vérifier le serveur
Connecté au serveur en tant qu'`ec2-user` :

```bash
cd ~/ikan && git status --short          # doit n'afficher aucune ligne « M » (fichier suivi modifié)
ls apps/client/.env* apps/dashboard/.env.production
```

- `apps/client/.env` (ou `.env.production`) doit contenir `PUBLIC_API_URL`.
- `apps/dashboard/.env.production` doit contenir `VITE_API_URL`, `VITE_CLIENT_URL` et `VITE_AGENT_URL`.
  Les builds lisent ces fichiers. S'il en manque un, le build s'arrête avec un message clair.

Si `git status` montre des fichiers modifiés sur le serveur, le déploiement s'arrête sans rien changer. Il faut
d'abord reporter ces modifications dans une PR, ou les annuler (`git checkout -- <fichier>`).

### 5. Premier essai à la main
Après la fusion de la PR qui ajoute ce script :

```bash
bash ~/ikan/scripts/deployer-ec2.sh
```

Le script affiche 5 étapes et se termine par « Déploiement terminé ». Ensuite, dans GitHub, onglet **Actions →
Déployer → Run workflow**, lancez le même déploiement depuis GitHub pour vérifier les étapes 1 à 3.

## En cas de problème

- **Où lire l'erreur** : dans GitHub, onglet Actions, ouvrez le déploiement en rouge. Le compte rendu du serveur s'y affiche.
- **Revenir au dashboard précédent** :
  `sudo mv /var/www/ikan-dashboard /var/www/ikan-dashboard.casse && sudo mv /var/www/ikan-dashboard.precedent /var/www/ikan-dashboard`
- **Revenir au code précédent** : le compte rendu indique la version d'avant (« Version : abc1234 → def5678 »).
  Sur le serveur, lancez `cd ~/ikan && git checkout abc1234`, puis `sudo systemctl restart ikan-api ikan-agent ikan-veille ikan-client`.
  Corrigez ensuite par une PR. Le déploiement suivant remet `main`.
- **Migrations de base de données** : elles sont appliquées avant le redémarrage (`alembic upgrade head`). Elles ne
  sont jamais annulées automatiquement.
