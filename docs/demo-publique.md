# Démonstration publique — demo.ikanai.bf

Une adresse que l'on peut donner à n'importe qui (jury, prospect, partenaire) pour essayer IKAN AI **sans compte**.

## L'idée en une image

```
                     https://demo.ikanai.bf
                              │
                        nginx (serveur EC2)
            ┌─────────────────┼──────────────────┐
            │                 │                  │
     dashboard de démo     /api/ → API démo    /yam/ → YAM démo
   /var/www/ikan-demo-     (port 8100)         (port 8101)
        dashboard              └────────┬─────────┘
                                        │
                           base ikan_demo (données fictives)
                                        ▲
                     chaque nuit à 3 h 30 : remise à zéro
```

- **Même code que la production**, mais une **base à part**, remplie de données fictives. Un visiteur ne voit jamais les données
  d'un vrai client et ne peut rien y modifier.
- Sur la page de connexion, **un bouton par rôle** : « Responsable expérience client » et « Responsable d'agence ». Un clic, et
  on est dedans. Le formulaire de connexion reste en dessous pour l'équipe.
- Le visiteur peut **tout essayer** : prendre en charge une alerte, traiter un avis, créer un problème, parler à YAM…
- **Chaque nuit à 3 h 30**, la base revient à son état propre. Les dates avancent avec le calendrier : un avis « d'il y a
  3 jours » reste « d'il y a 3 jours », la démo ne vieillit jamais.
- Un bandeau discret rappelle en haut de chaque page : « Démonstration — données fictives, remises à zéro chaque nuit. »

### Ce qui est bloqué dans la démo (pour ne pas gêner le visiteur suivant)

| Action | Pourquoi |
|---|---|
| Changer le mot de passe ou l'e-mail d'un compte d'entrée | Le bouton ne trouverait plus le compte |
| Modifier ou désactiver un compte d'entrée (depuis le CX Manager) | Idem |
| Paiement (changement de forfait) | Aucune transaction, même de test |
| Relier une vraie Page Facebook | Aucune vraie donnée dans la démo |

E-mails, paiements, WhatsApp et veille réelle sont en plus **désactivés par la configuration** (clés laissées vides).

### Les garde-fous

- L'API **refuse de démarrer** si `DEMO_MODE=oui` vise la base de production. Impossible d'ouvrir par erreur une porte sans mot
  de passe sur les vraies données.
- La remise à zéro **refuse** toute base qui n'est pas celle d'une démo, et toujours la production (sans contournement possible).
- Hors démo, les routes `/auth/demo` n'existent pas (404) et le dashboard de production ne les appelle jamais.

---

## Mise en place (une seule fois)

Toutes les commandes se lancent **sur le serveur EC2**, connecté en `ec2-user`. Comptez environ une heure.

### Étape 1 — L'adresse demo.ikanai.bf

Chez le gestionnaire du domaine `ikanai.bf`, ajoutez un enregistrement :

| Type | Nom | Valeur |
|---|---|---|
| A | `demo` | l'adresse IP publique du serveur EC2 (la même que `app.ikanai.bf`) |

Vérification (quelques minutes à quelques heures plus tard) : `ping demo.ikanai.bf` répond avec l'IP du serveur.

### Étape 2 — La base de démo

Une base PostgreSQL **sur le serveur**, séparée de Supabase (gratuite, et jamais confondue avec la production) :

```bash
sudo dnf install -y postgresql17-server postgresql17     # ou la version de vos projets Supabase
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER ikan_demo WITH PASSWORD 'UN_MOT_DE_PASSE_LONG';"
sudo -u postgres psql -c "CREATE DATABASE ikan_demo OWNER ikan_demo;"
```

> Si la connexion est refusée (« Ident authentication failed »), dans `/var/lib/pgsql/data/pg_hba.conf`, remplacez `ident` par
> `scram-sha-256` sur les lignes `host … 127.0.0.1/32` et `::1/128`, puis `sudo systemctl restart postgresql`.

### Étape 3 — La configuration

```bash
mkdir -p ~/ikan-demo && chmod 700 ~/ikan-demo
cp ~/ikan/scripts/demo/api.env.exemple       ~/ikan-demo/api.env
cp ~/ikan/scripts/demo/agent.env.exemple     ~/ikan-demo/agent.env
cp ~/ikan/scripts/demo/dashboard.env.exemple ~/ikan-demo/dashboard.env
chmod 600 ~/ikan-demo/*.env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # deux fois : SECRET_KEY, puis WEBHOOK_SECRET
```

Remplissez `api.env` et `agent.env` (mot de passe de l'étape 2, les deux secrets générés, **identiques** dans les deux fichiers).
Ne mettez **jamais** une valeur de la production. Pour YAM, une clé Groq séparée est préférable : les visiteurs consomment son quota.

### Étape 4 — Remplir la base avec des données fictives

Le plus simple est de **copier la base de développement** `ikanai-dev` (déjà remplie avec Orange Burkina Faso), puis de mettre
la structure à jour :

```bash
pg_dump --format=custom --no-owner --no-privileges --schema=public \
        --dbname="postgresql://…adresse de ikanai-dev…" --file=/tmp/dev.dump
pg_restore --no-owner --no-privileges --dbname="postgresql://ikan_demo:…@127.0.0.1:5432/ikan_demo" /tmp/dev.dump
rm /tmp/dev.dump

cd ~/ikan/apps/api   && set -a && . ~/ikan-demo/api.env   && set +a && .venv/bin/alembic upgrade head
cd ~/ikan/apps/agent && set -a && . ~/ikan-demo/agent.env && set +a && .venv/bin/alembic upgrade head
```

> **Jamais la base de production.** Avant de copier `ikanai-dev`, vérifiez qu'elle ne contient aucune donnée réelle (vrais
> numéros de téléphone ou e-mails laissés pendant des tests). La démo est publique.

Puis choisissez **les deux comptes d'entrée** : un CX Manager et un Agency Manager de la base de démo. Le plus clair est de leur
donner des adresses dédiées (`cx@demo.ikanai.bf`, `agence@demo.ikanai.bf`), dans la page Utilisateurs ou en SQL. Reportez ces
deux e-mails dans `api.env` (`DEMO_COMPTE_CX`, `DEMO_COMPTE_AGENCE`). Leur mot de passe n'a aucune importance : personne ne le tape.

### Étape 5 — Les services

```bash
sudo cp ~/ikan/scripts/demo/ikan-api-demo.service ~/ikan/scripts/demo/ikan-agent-demo.service \
        ~/ikan/scripts/demo/ikan-demo-remise-a-zero.service ~/ikan/scripts/demo/ikan-demo-remise-a-zero.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ikan-api-demo ikan-agent-demo
curl -s http://127.0.0.1:8100/api/v1/auth/demo     # doit répondre {"roles":["cx_manager","agency_manager"]}
```

S'il ne répond pas : `sudo journalctl -u ikan-api-demo -n 30`. Un message « Démarrage refusé » explique ce qui manque.

### Étape 6 — nginx et HTTPS

```bash
sudo cp ~/ikan/scripts/demo/nginx-demo.conf /etc/nginx/conf.d/ikan-demo.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d demo.ikanai.bf
```

### Étape 7 — Le dashboard de démo

Le script de déploiement s'en charge désormais tout seul : dès que le service `ikan-api-demo` existe, chaque déploiement
construit **aussi** le dashboard de démo et relance la démo. Pour la première fois, lancez-le à la main :

```bash
bash ~/ikan/scripts/deployer-ec2.sh
```

Ouvrez https://demo.ikanai.bf : les deux boutons apparaissent. Essayez-les.

### Étape 8 — Figer l'état propre et activer la remise à zéro

Quand la démo vous plaît telle quelle (c'est l'état que chaque visiteur trouvera) :

```bash
cd ~/ikan/apps/api && set -a && . ~/ikan-demo/api.env && set +a
.venv/bin/python scripts/demo_remettre_a_zero.py capturer --fichier ~/ikan-demo/reference.dump
sudo systemctl enable --now ikan-demo-remise-a-zero.timer
```

Test immédiat : modifiez quelque chose dans la démo, puis `sudo systemctl start ikan-demo-remise-a-zero` ; la modification a
disparu. Pour changer plus tard l'état propre, arrangez la démo puis relancez la commande `capturer`.

---

## Au quotidien

| Besoin | Commande |
|---|---|
| Remettre la démo à zéro tout de suite | `sudo systemctl start ikan-demo-remise-a-zero` |
| Voir la dernière remise à zéro | `sudo journalctl -u ikan-demo-remise-a-zero -n 20` |
| Prochaine remise à zéro | `systemctl list-timers ikan-demo-remise-a-zero.timer` |
| Arrêter la démo | `sudo systemctl disable --now ikan-api-demo ikan-agent-demo ikan-demo-remise-a-zero.timer` |

**Mise à jour du code** : rien à faire. Une copie de référence capturée avant une nouvelle version reçoit les migrations à chaque
remise à zéro.

**Pas encore dans la démo** : le scan d'un QR code depuis un téléphone (formulaire client). Les avis existants suffisent à tout
montrer du dashboard ; un formulaire client de démo pourra être ajouté ensuite.
