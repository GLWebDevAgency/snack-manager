#!/usr/bin/env bash
#
# LANCE UNE REPRISE DE DONNÉES MONGO sur un environnement Railway.
#
# Le `preDeployCommand` de Railway migre le schéma PostgreSQL, et lui seul.
# Mongoose n'a pas de migration de schéma : un champ ajouté apparaît avec son
# défaut, et les documents existants gardent leur forme d'avant. Ce sont les
# scripts `backfill:*` qui les reprennent — et ils ne partent pas tout seuls,
# délibérément : une reprise de données se relit avant d'être appliquée.
#
# ── Pourquoi un script plutôt qu'une procédure écrite ──────────────────────
#
# Trois pièges, tous rencontrés en la déroulant à la main le 28/08/2026 :
#
#   1. `railway run` n'irait PAS. Il injecte les variables mais exécute en
#      local, où `mongodb.railway.internal` ne se résout pas. Il faut passer
#      par le proxy TCP public du service MongoDB.
#
#   2. L'URL du proxy ne porte AUCUN nom de base. Sans `/snackmanager`, le
#      script se connecte à la base `test` et annonce sereinement « 0 client à
#      reprendre ». C'est le plus coûteux des trois : il ne lève pas, il
#      rassure.
#
#   3. La CLI Railway reste sur le DERNIER environnement utilisé. Une commande
#      lancée sans vérifier vise la production sans le dire — c'est ainsi
#      qu'un `railway redeploy` a redéployé la production au lieu de staging.
#
# Une procédure écrite se recopie de travers ; un script se lance.
#
# ── Sûreté ────────────────────────────────────────────────────────────────
#
# L'URL de connexion n'est jamais affichée ni écrite sur disque : elle vit dans
# l'environnement du seul processus enfant. La production exige une
# confirmation tapée à la main.
#
#   scripts/reprise-mongo.sh staging backfill:founder
#   scripts/reprise-mongo.sh staging backfill:founder --appliquer
#
set -euo pipefail

ENVIRONNEMENT="${1:-}"
TACHE="${2:-}"
APPLIQUER="${3:-}"
BASE="${SM_MONGO_BASE:-snackmanager}"

if [[ -z "$ENVIRONNEMENT" || -z "$TACHE" ]]; then
  cat <<'USAGE'
Usage :
    scripts/reprise-mongo.sh <staging|production> <tâche> [--appliquer]

Tâches disponibles (voir packages/db/package.json) :
    backfill:founder   pose founderUntil et founderDiscountCents
    backfill:contact   reprend le téléphone du gérant depuis son lead
    backfill:tracking  pose les jetons de suivi manquants

Sans --appliquer, la tâche LIT et n'écrit rien. C'est le mode par défaut, et
c'est celui par lequel on commence toujours.
USAGE
  exit 2
fi

if [[ "$ENVIRONNEMENT" != "staging" && "$ENVIRONNEMENT" != "production" ]]; then
  echo "Environnement « $ENVIRONNEMENT » inconnu — attendu : staging ou production." >&2
  exit 2
fi

# ── L'environnement est POSÉ, jamais supposé ─────────────────────────────
# La CLI reste sur le dernier utilisé, et c'est ainsi qu'on redéploie la
# production en croyant viser staging.
railway environment "$ENVIRONNEMENT" >/dev/null
echo "▶ ${TACHE} · ${ENVIRONNEMENT} · base « ${BASE} »"

if [[ "$ENVIRONNEMENT" == "production" ]]; then
  echo
  echo "  Ceci touche les données de VRAIS restaurants."
  read -r -p "  Tapez « production » pour confirmer : " aveu
  [[ "$aveu" == "production" ]] || { echo "  Abandon."; exit 1; }
fi

# ── L'accès, composé depuis le proxy TCP public ──────────────────────────
# `--kv` rend `CLE=valeur` : on ne garde que les quatre nécessaires, et rien
# n'est affiché.
eval "$(railway variables --service MongoDB --kv \
  | grep -E '^(MONGOUSER|MONGOPASSWORD|RAILWAY_TCP_PROXY_DOMAIN|RAILWAY_TCP_PROXY_PORT)=' \
  | sed 's/^/export /')"

for requis in MONGOUSER MONGOPASSWORD RAILWAY_TCP_PROXY_DOMAIN RAILWAY_TCP_PROXY_PORT; do
  [[ -n "${!requis:-}" ]] || { echo "  ✗ ${requis} introuvable sur le service MongoDB." >&2; exit 1; }
done

hote="${RAILWAY_TCP_PROXY_DOMAIN}:${RAILWAY_TCP_PROXY_PORT}"
echo "  proxy : ${hote}"

# L'URL vit dans l'environnement du processus enfant, et nulle part ailleurs.
identifiants="${MONGOUSER}:${MONGOPASSWORD}"
export MONGO_URL="mongodb://${identifiants}@${hote}/${BASE}?authSource=admin"
unset MONGOPASSWORD identifiants

echo
if [[ "$APPLIQUER" == "--appliquer" ]]; then
  pnpm --filter @sm/db "$TACHE" -- --appliquer
  echo
  echo "▶ Relance de contrôle — une reprise idempotente ne doit plus rien trouver."
  pnpm --filter @sm/db "$TACHE"
else
  pnpm --filter @sm/db "$TACHE"
fi
