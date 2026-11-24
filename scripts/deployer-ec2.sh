#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Déploiement IKAN AI sur le serveur EC2, à lancer SUR le serveur (par GitHub Actions ou à la main) :
#
#     bash /home/ec2-user/ikan/scripts/deployer-ec2.sh
#
# Ce qu'il fait, dans l'ordre, et s'arrête à la première erreur :
#   1. récupère la dernière version de main (refuse si des fichiers suivis ont été modifiés sur le serveur) ;
#   2. met à jour les dépendances Python (API, YAM, veille) et applique les migrations (API, YAM) ;
#   3. construit le formulaire client et le dashboard ;
#   4. publie le dashboard dans /var/www/ikan-dashboard (la version précédente reste dans ikan-dashboard.precedent) ;
#   5. relance les services systemd et vérifie qu'ils répondent.
#
# Secrets : aucun ici. Les builds lisent les fichiers .env déjà présents sur le serveur
# (apps/client/.env*, apps/dashboard/.env.production) ; les services gardent leur configuration systemd.
# Le site vitrine (ikan-site-api, /var/www/ikan-site) n'est jamais touché.
#
# Démonstration publique (docs/demo-publique.md) : SEULEMENT si elle est installée (unité ikan-api-demo présente), le même code
# est aussi migré, construit (dashboard de démo, /var/www/ikan-demo-dashboard) et relancé pour demo.ikanai.bf. Sa configuration
# est lue dans /home/ec2-user/ikan-demo/ (api.env, agent.env, dashboard.env). Sans démo installée, rien ne change.
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

RACINE="${IKAN_RACINE:-/home/ec2-user/ikan}"
BRANCHE="${IKAN_BRANCHE:-main}"
DOSSIER_DASHBOARD="${IKAN_DOSSIER_DASHBOARD:-/var/www/ikan-dashboard}"
SERVICES_PYTHON=(api agent veille)          # dossiers apps/<nom>, chacun avec son .venv
SERVICES_SYSTEMD=(ikan-api ikan-agent ikan-veille ikan-client)
DOSSIER_DEMO="${IKAN_DOSSIER_DEMO:-/home/ec2-user/ikan-demo}"
DOSSIER_DASHBOARD_DEMO="${IKAN_DOSSIER_DASHBOARD_DEMO:-/var/www/ikan-demo-dashboard}"
DEMO=0
if systemctl cat ikan-api-demo >/dev/null 2>&1; then DEMO=1; SERVICES_SYSTEMD+=(ikan-api-demo ikan-agent-demo); fi

etape() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
echec() { printf '\n\033[31mÉCHEC : %s\033[0m\n' "$*" >&2; exit 1; }
trap 'echec "ligne $LINENO : « $BASH_COMMAND »"' ERR

# Node vient de nvm sur ce serveur : on le charge pour une session non interactive (SSM, SSH sans terminal).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
command -v node >/dev/null || echec "node introuvable (nvm non chargé ?)"

cd "$RACINE"

etape "1/5 Code : dernière version de $BRANCHE"
if ! git diff --quiet || ! git diff --cached --quiet; then
  git status --short
  echec "des fichiers suivis par git ont été modifiés sur le serveur : rien n'est déployé (voir la liste ci-dessus)."
fi
AVANT="$(git rev-parse --short HEAD)"
git fetch --quiet origin "$BRANCHE"
git checkout --quiet "$BRANCHE"
git merge --ff-only --quiet "origin/$BRANCHE"
APRES="$(git rev-parse --short HEAD)"
echo "Version : $AVANT → $APRES"
git log --oneline "$AVANT..$APRES" | head -20 || true

etape "2/5 Python : dépendances et migrations"
for app in "${SERVICES_PYTHON[@]}"; do
  venv="$RACINE/apps/$app/.venv"
  [ -x "$venv/bin/pip" ] || echec "environnement Python manquant : $venv"
  echo "-- $app"
  "$venv/bin/pip" install --quiet --disable-pip-version-check -r "$RACINE/apps/$app/requirements.txt"
  if [ -f "$RACINE/apps/$app/alembic.ini" ]; then
    # Même configuration que le service (APP_ENV=production, DATABASE_URL…) : on la lit dans son unité systemd,
    # sans jamais l'afficher. Le démarrage de l'API applique aussi la garde de production avec APP_ENV.
    unite="ikan-$app"
    (
      cd "$RACINE/apps/$app"
      # Variables « Environment= » de l'unité, puis fichier « EnvironmentFile= » lu ligne à ligne : CLÉ=VALEUR exportée
      # telle quelle, guillemets retirés, JAMAIS exécutée (un .env n'est pas un script) ni affichée.
      # shellcheck disable=SC2163  # export de la ligne « CLÉ=VALEUR » elle-même, voulu
      while IFS= read -r ligne; do [[ "$ligne" == *=* ]] && export "$ligne"; done < <(systemctl show "$unite" -p Environment --value | tr ' ' '\n')
      fichier_env="$(systemctl show "$unite" -p EnvironmentFiles --value 2>/dev/null | awk '{print $1}' || true)"
      if [ -n "$fichier_env" ] && [ -r "$fichier_env" ]; then
        while IFS= read -r ligne || [ -n "$ligne" ]; do
          ligne="${ligne%$'\r'}"
          [[ "$ligne" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
          cle="${BASH_REMATCH[2]}"; valeur="${BASH_REMATCH[3]}"
          if [[ "$valeur" =~ ^\"(.*)\"$ ]] || [[ "$valeur" =~ ^\'(.*)\'$ ]]; then valeur="${BASH_REMATCH[1]}"; fi
          export "$cle=$valeur"
        done < "$fichier_env"
      fi
      "$venv/bin/alembic" upgrade head
    )
  fi
done

if [ "$DEMO" -eq 1 ]; then
  # Démonstration : mêmes migrations, sur SA base (configuration lue sans exécution ni affichage, comme ci-dessus).
  for app in api agent; do
    echo "-- $app (démonstration)"
    (
      fichier_env="$DOSSIER_DEMO/$app.env"
      [ -r "$fichier_env" ] || echec "configuration de la démonstration introuvable : $fichier_env"
      while IFS= read -r ligne || [ -n "$ligne" ]; do
        ligne="${ligne%$'\r'}"
        [[ "$ligne" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
        cle="${BASH_REMATCH[2]}"; valeur="${BASH_REMATCH[3]}"
        if [[ "$valeur" =~ ^\"(.*)\"$ ]] || [[ "$valeur" =~ ^\'(.*)\'$ ]]; then valeur="${BASH_REMATCH[1]}"; fi
        export "$cle=$valeur"
      done < "$fichier_env"
      cd "$RACINE/apps/$app" && "$RACINE/apps/$app/.venv/bin/alembic" upgrade head
    )
  done
fi

etape "3/5 Builds : formulaire client et dashboard"
( cd "$RACINE/apps/client" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent )
( cd "$RACINE/apps/dashboard" && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent )
[ -f "$RACINE/apps/dashboard/dist/index.html" ] || echec "le build du dashboard n'a pas produit dist/index.html"
if [ "$DEMO" -eq 1 ]; then
  # Dashboard de démonstration : même code, adresses de demo.ikanai.bf (l'environnement passe avant les fichiers .env de Vite).
  (
    [ -r "$DOSSIER_DEMO/dashboard.env" ] || echec "configuration introuvable : $DOSSIER_DEMO/dashboard.env"
    while IFS= read -r ligne || [ -n "$ligne" ]; do
      ligne="${ligne%$'\r'}"
      [[ "$ligne" =~ ^[[:space:]]*(VITE_[A-Z0-9_]*)=(.*)$ ]] || continue
      cle="${BASH_REMATCH[1]}"; valeur="${BASH_REMATCH[2]}"
      if [[ "$valeur" =~ ^\"(.*)\"$ ]] || [[ "$valeur" =~ ^\'(.*)\'$ ]]; then valeur="${BASH_REMATCH[1]}"; fi
      export "$cle=$valeur"
    done < "$DOSSIER_DEMO/dashboard.env"
    cd "$RACINE/apps/dashboard" && npx vite build --outDir dist-demo --emptyOutDir --logLevel error
  )
  [ -f "$RACINE/apps/dashboard/dist-demo/index.html" ] || echec "le build du dashboard de démonstration n'a pas produit dist-demo/index.html"
fi

etape "4/5 Dashboard : publication dans $DOSSIER_DASHBOARD"
PRECEDENT="${DOSSIER_DASHBOARD}.precedent"
NOUVEAU="${DOSSIER_DASHBOARD}.nouveau"
# Copie complète à côté, puis échange des dossiers : jamais de site à moitié copié (pas besoin de rsync).
sudo rm -rf "$NOUVEAU" "$PRECEDENT"
sudo cp -r "$RACINE/apps/dashboard/dist" "$NOUVEAU"
sudo chmod -R a+rX "$NOUVEAU"
if [ -d "$DOSSIER_DASHBOARD" ]; then sudo mv "$DOSSIER_DASHBOARD" "$PRECEDENT"; fi
sudo mv "$NOUVEAU" "$DOSSIER_DASHBOARD"
echo "Version précédente gardée dans $PRECEDENT"
if [ "$DEMO" -eq 1 ]; then
  sudo rm -rf "${DOSSIER_DASHBOARD_DEMO}.nouveau"
  sudo cp -r "$RACINE/apps/dashboard/dist-demo" "${DOSSIER_DASHBOARD_DEMO}.nouveau"
  sudo chmod -R a+rX "${DOSSIER_DASHBOARD_DEMO}.nouveau"
  sudo rm -rf "$DOSSIER_DASHBOARD_DEMO" && sudo mv "${DOSSIER_DASHBOARD_DEMO}.nouveau" "$DOSSIER_DASHBOARD_DEMO"
  echo "Dashboard de démonstration publié dans $DOSSIER_DASHBOARD_DEMO"
fi

etape "5/5 Services : redémarrage et vérification"
sudo systemctl restart "${SERVICES_SYSTEMD[@]}"
sleep 6
probleme=0
for s in "${SERVICES_SYSTEMD[@]}"; do
  if systemctl is-active --quiet "$s"; then
    port="$(systemctl show "$s" -p ExecStart --value | grep -oE -- '--port[ =][0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
    if [ -n "$port" ]; then
      code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$port/" || echo 000)"
      echo "ok   $s (port $port, HTTP $code)"
      [ "$code" = "000" ] && probleme=1
    else
      echo "ok   $s"
    fi
  else
    echo "KO   $s"; sudo journalctl -u "$s" -n 20 --no-pager || true
    probleme=1
  fi
done
[ "$probleme" -eq 0 ] || echec "au moins un service ne répond pas (journal ci-dessus). Version précédente du code : $AVANT"

printf '\n\033[32mDéploiement terminé : %s → %s\033[0m\n' "$AVANT" "$APRES"
