#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────
# Démonstration publique : remise à zéro de la base de démo (docs/demo-publique.md).
# Lancé chaque nuit par ikan-demo-remise-a-zero.timer, ou à la main :
#
#     sudo bash /home/ec2-user/ikan/scripts/demo/remettre-a-zero.sh
#
#   1. arrête l'API et YAM de la démo (personne n'écrit pendant la restauration) ;
#   2. restaure la copie de référence et avance les dates (apps/api/scripts/demo_remettre_a_zero.py) ;
#   3. applique les migrations (API, puis YAM) : une copie capturée avant une mise à jour reçoit le schéma du code actuel ;
#   4. relance l'API et YAM de la démo, MÊME en cas d'échec (une démo arrêtée est pire qu'une démo pas remise à zéro).
#
# Ne touche jamais à la production : la configuration lue est celle de la démo (fichiers ci-dessous), et le script Python
# refuse de lui-même la base de production et toute configuration sans DEMO_MODE=oui. Aucun secret n'est affiché.
# ──────────────────────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

RACINE="${IKAN_RACINE:-/home/ec2-user/ikan}"
DOSSIER_DEMO="${IKAN_DOSSIER_DEMO:-/home/ec2-user/ikan-demo}"
REFERENCE="$DOSSIER_DEMO/reference.dump"
SERVICES=(ikan-api-demo ikan-agent-demo)

# Lit un fichier CLÉ=VALEUR (format .env) et exporte chaque ligne telle quelle, guillemets retirés : JAMAIS exécuté, jamais affiché.
charger_env() {
  local ligne cle valeur
  [ -r "$1" ] || { echo "Configuration introuvable : $1" >&2; return 1; }
  while IFS= read -r ligne || [ -n "$ligne" ]; do
    ligne="${ligne%$'\r'}"
    [[ "$ligne" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    cle="${BASH_REMATCH[2]}"; valeur="${BASH_REMATCH[3]}"
    if [[ "$valeur" =~ ^\"(.*)\"$ ]] || [[ "$valeur" =~ ^\'(.*)\'$ ]]; then valeur="${BASH_REMATCH[1]}"; fi
    export "$cle=$valeur"
  done < "$1"
}

relancer() { systemctl start "${SERVICES[@]}" || true; }
trap relancer EXIT

systemctl stop "${SERVICES[@]}" || true

(
  charger_env "$DOSSIER_DEMO/api.env"
  cd "$RACINE/apps/api"
  sudo -E -u ec2-user .venv/bin/python scripts/demo_remettre_a_zero.py restaurer --fichier "$REFERENCE"
  sudo -E -u ec2-user .venv/bin/alembic upgrade head
)
(
  charger_env "$DOSSIER_DEMO/agent.env"
  cd "$RACINE/apps/agent"
  sudo -E -u ec2-user .venv/bin/alembic upgrade head
)
echo "Remise à zéro terminée ; relance de ${SERVICES[*]}."
