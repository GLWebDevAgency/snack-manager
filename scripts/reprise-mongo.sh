#!/usr/bin/env bash
#
# LANCE UNE REPRISE DE DONNÉES MONGO sur un environnement Railway.
#
# Le job de déploiement GitHub migre PostgreSQL ; ce script ne reprend que Mongo.
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
#   scripts/reprise-mongo.sh staging backfill:brand --appliquer --reparer
#
set -euo pipefail

ENVIRONNEMENT="${1:-}"
TACHE="${2:-}"
BASE="${SM_MONGO_BASE:-snackmanager}"

# La tâche est une liste positive, jamais une commande pnpm arbitraire.
# Les drapeaux métier (`--reparer`) restent transmis à la reprise autorisée.
OPTIONS=()
if [[ $# -gt 2 ]]; then
  shift 2
  OPTIONS=("$@")
fi
APPLIQUER=non
for drapeau in ${OPTIONS[@]+"${OPTIONS[@]}"}; do
  if [[ "$drapeau" == "--appliquer" ]]; then APPLIQUER=oui; fi
done

if [[ -z "$ENVIRONNEMENT" || -z "$TACHE" ]]; then
  cat <<'USAGE'
Usage :
    scripts/reprise-mongo.sh <staging|production> <tâche> [drapeaux…]

Tâches disponibles (voir packages/db/package.json) :
    backfill:founder   pose founderUntil et founderDiscountCents
    backfill:contact   reprend le téléphone du gérant depuis son lead
    backfill:brand     pose le masque d'identité (Nuit + accent + logo) sur les
                       tenants d'avant, et NOMME ceux dont le masque stocké est
                       invalide (--reparer pour les remplacer)
    backfill:medias    reprend les références des médias
    backfill:tracking  pose les jetons de suivi manquants — --appliquer OBLIGATOIRE

Sans --appliquer, les reprises à mode lecture n'écrivent rien.
backfill:tracking écrit immédiatement : ce lanceur la refuse sans --appliquer
et ne la relance jamais automatiquement comme un contrôle en lecture seule.
Seeds, copies, purges et tâches arbitraires sont exclus de ce lanceur Railway.
USAGE
  exit 2
fi

if [[ "$ENVIRONNEMENT" != "staging" && "$ENVIRONNEMENT" != "production" ]]; then
  echo "Environnement « $ENVIRONNEMENT » inconnu — attendu : staging ou production." >&2
  exit 2
fi

# Valider AVANT Railway et AVANT la récupération de ses accès. Une tâche telle
# que seed:orders ne doit jamais recevoir les credentials d'une base servie.
case "$TACHE" in
  backfill:founder|backfill:contact|backfill:brand|backfill:medias) ;;
  backfill:tracking)
    if [[ "$APPLIQUER" != "oui" ]]; then
      echo "backfill:tracking exige --appliquer ; aucun mode lecture n'est disponible." >&2
      exit 2
    fi
    ;;
  *)
    echo "Tâche non autorisée : seules les reprises backfill listées sont disponibles." >&2
    exit 2
    ;;
esac

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
#
# `--kv` rend une ligne `CLE=valeur` par variable, qu'on lit une par une.
# PAS d'`eval` : il faisait réinterpréter les VALEURS par le shell — un mot de
# passe contenant `$`, un accent grave, `;` ou une espace en ressortait
# transformé, et une sous-commande y aurait été exécutée. Rien n'est affiché,
# et rien n'est exporté : le mot de passe ne quitte pas ce script.
mongo_utilisateur=''
mongo_motdepasse=''
proxy_domaine=''
proxy_port=''

# `IFS='='` coupe au PREMIER `=` : le reste de la ligne — signes `=` compris —
# reste dans la valeur.
while IFS='=' read -r cle valeur; do
  case "$cle" in
    MONGOUSER) mongo_utilisateur="$valeur" ;;
    MONGOPASSWORD) mongo_motdepasse="$valeur" ;;
    RAILWAY_TCP_PROXY_DOMAIN) proxy_domaine="$valeur" ;;
    RAILWAY_TCP_PROXY_PORT) proxy_port="$valeur" ;;
  esac
done < <(railway variables --service MongoDB --kv)

for requis in \
  mongo_utilisateur:MONGOUSER \
  mongo_motdepasse:MONGOPASSWORD \
  proxy_domaine:RAILWAY_TCP_PROXY_DOMAIN \
  proxy_port:RAILWAY_TCP_PROXY_PORT
do
  # `variable_locale:NOM_RAILWAY` — le nom local est déréférencé, le nom
  # Railway est celui que l'opérateur ira chercher dans le tableau de bord.
  locale="${requis%%:*}"
  [[ -n "${!locale}" ]] || {
    echo "  ✗ ${requis##*:} introuvable sur le service MongoDB." >&2
    exit 1
  }
done

hote="${proxy_domaine}:${proxy_port}"
echo "  proxy : ${hote}"

# ── RFC 3986 : le userinfo d'une URI s'ENCODE ────────────────────────────
# Un mot de passe contenant `@`, `:`, `/` ou `?` — Railway en génère — coupe
# l'URI en deux : la connexion part sur un hôte fantôme, ou échoue sans dire
# pourquoi. Le secret est passé à node sur son ENTRÉE STANDARD ; en argument,
# il aurait été lisible dans `ps` par tout le poste.
encoder() { printf %s "$1" | node -p 'encodeURIComponent(require("fs").readFileSync(0, "utf8"))'; }

# L'URL vit dans l'environnement du processus enfant, et nulle part ailleurs.
export MONGO_URL="mongodb://$(encoder "$mongo_utilisateur"):$(encoder "$mongo_motdepasse")@${hote}/${BASE}?authSource=admin"
unset mongo_motdepasse

echo
if [[ "$APPLIQUER" == "oui" ]]; then
  pnpm --filter @sm/db "$TACHE" -- ${OPTIONS[@]+"${OPTIONS[@]}"}
  if [[ "$TACHE" == "backfill:tracking" ]]; then
    echo "Reprise tracking exécutée une fois. Aucun second writer lancé sous couvert de contrôle."
    exit 0
  fi
  echo
  echo "▶ Relance de contrôle — une reprise idempotente ne doit plus rien trouver."
  # `--exiger-zero` fait SORTIR la relance en échec s'il reste du travail.
  # Sans lui, elle se contentait d'afficher son décompte : une reprise non
  # idempotente, ou des écritures ignorées parce que le document avait changé
  # entre la lecture et l'écriture, laissaient le script vert et c'est l'œil
  # de l'opérateur qui devait repérer la ligne « N document(s) ».
  if ! pnpm --filter @sm/db "$TACHE" -- --exiger-zero; then
    echo
    echo "  ✗ La relance de contrôle a ENCORE trouvé du travail." >&2
    echo "    Relire son compte rendu ci-dessus : soit des écritures ont été ignorées" >&2
    echo "    (le document avait changé entre-temps — relancer la tâche suffit), soit" >&2
    echo "    des documents ne sont pas reprenables en l'état et la tâche dit lesquels" >&2
    echo "    (backfill:brand : un masque stocké INVALIDE, que --reparer remplace)." >&2
    exit 3
  fi
else
  pnpm --filter @sm/db "$TACHE"
fi
