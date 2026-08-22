/**
 * OÙ LES TESTS TAPENT.
 *
 * Les tests de bout en bout ne connaissent aucune adresse en dur : ils
 * demandent une cible à ce module, et lui seul décide. Trois environnements
 * sont prévus, et chaque surface reste surchargeable indépendamment — viser une
 * seule application en local pendant qu'on met au point un scénario est le
 * geste le plus fréquent, il ne doit pas demander de modifier un fichier.
 *
 *     SM_E2E_CIBLE=staging|production|local   (défaut : staging)
 *     SM_E2E_WEB=…  SM_E2E_POS=…  SM_E2E_KDS=…  SM_E2E_API=…
 *
 * Ces adresses sont PUBLIQUES — ce sont celles qu'un client tape dans son
 * navigateur. Les écrire ici n'est pas une fuite : c'est la même documentation
 * exécutable que dans `scripts/smoke.mjs`, et les deux fichiers doivent dire la
 * même chose. Si l'un change d'hôte, l'autre aussi.
 */

const PARC = {
  staging: {
    api: 'https://api-staging-a5e8.up.railway.app',
    web: 'https://web-staging-6f5f.up.railway.app',
    pos: 'https://pos-staging-7f92.up.railway.app',
    kds: 'https://kds-staging-90da.up.railway.app',
    /** Établissement réel du parc, seul concerné par les scénarios « réel ». */
    slug: 'classfood',
  },
  production: {
    api: 'https://api-production-8949.up.railway.app',
    web: 'https://web-production-99b58c.up.railway.app',
    pos: 'https://pos-production-a9d8.up.railway.app',
    kds: 'https://kds-production-8991.up.railway.app',
    // ⚠️ VIDE À DESSEIN — même raison que dans `scripts/smoke.mjs` : la base de
    // production a été remise à blanc, il n'y a aucun établissement. Les
    // scénarios « réel » s'annoncent alors IGNORÉS, bruyamment, plutôt que de
    // rougir pour une raison qui n'est pas une panne. Le jour où le premier
    // restaurant est en ligne : poser son slug ici.
    slug: '',
  },
  local: {
    api: 'http://localhost:3001',
    web: 'http://localhost:3000',
    pos: 'http://localhost:8082',
    kds: 'http://localhost:8083',
    slug: 'classfood',
  },
};

/** Nom d'environnement demandé, validé — une faute de frappe ne doit pas viser staging en silence. */
export function environnement() {
  const demande = process.env.SM_E2E_CIBLE ?? 'staging';
  if (!(demande in PARC)) {
    throw new Error(
      `SM_E2E_CIBLE=« ${demande} » inconnu. Valeurs acceptées : ${Object.keys(PARC).join(', ')}.`,
    );
  }
  return demande;
}

/** Les quatre adresses + le slug, surcharges d'environnement appliquées. */
export function cibles() {
  const base = PARC[environnement()];
  const sans = (url) => url.replace(/\/+$/, '');
  return {
    nom: environnement(),
    api: sans(process.env.SM_E2E_API ?? base.api),
    web: sans(process.env.SM_E2E_WEB ?? base.web),
    pos: sans(process.env.SM_E2E_POS ?? base.pos),
    kds: sans(process.env.SM_E2E_KDS ?? base.kds),
    slug: process.env.SM_E2E_SLUG ?? base.slug,
  };
}

/**
 * Délai maximal d'une attente d'écran, en millisecondes.
 *
 * Il est GÉNÉREUX par choix. Ces tests visent des surfaces déployées derrière
 * un routeur qui peut réveiller un conteneur ; un délai serré ne rendrait pas
 * les tests plus rapides — un test qui réussit n'attend pas la borne — il les
 * rendrait faux au premier démarrage à froid.
 */
export const DELAI_ECRAN = Number(process.env.SM_E2E_DELAI ?? 30_000);

/**
 * Budget d'attente d'une PROPAGATION serveur → vitrine.
 *
 * La page publique d'un restaurant est rendue par Next.js avec un cache de
 * 60 s (`SITE_TTL`, `components/order/api.ts`). Un changement de prix ou une
 * suspension met donc jusqu'à une minute à s'y voir.
 *
 * Mesures réelles contre staging, le 20 août 2026 : 0,3 · 4,5 · 4,5 · 4,6 s
 * quand le cache venait d'être rafraîchi ; 46,8 · 59,4 · 59,6 · 60,4 · 64,0 s
 * quand il était froid. Le maximum observé dépasse donc les 60 s annoncés — le
 * premier appel après expiration peut servir la version périmée et ne
 * rafraîchir qu'en arrière-plan. Le budget est calé à deux fois et demie ce
 * maximum : il ne coûte rien quand le test passe, et il évite le seul faux
 * rouge que ce dossier puisse produire.
 */
export const DELAI_PROPAGATION = Number(process.env.SM_E2E_DELAI_PROPAGATION ?? 150_000);
