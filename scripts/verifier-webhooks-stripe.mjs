#!/usr/bin/env node
/**
 * Vérification de la chaîne webhook Stripe — « une commande payée en ligne
 * arriverait-elle jusqu'à la cuisine, là, maintenant ? »
 *
 *     WHSEC_COMPTE=whsec_… WHSEC_CONNECT=whsec_… \
 *       node scripts/verifier-webhooks-stripe.mjs staging
 *
 * ── Pourquoi ce script existe, et pourquoi il n'est PAS dans smoke.mjs ──────
 *
 * `smoke.mjs` ne touche qu'à des surfaces publiques, sans le moindre secret,
 * pour pouvoir tourner dans un job dont le journal est lisible par tous. Ici
 * c'est l'inverse : signer un événement DEMANDE le secret du point d'entrée.
 * Ce script se lance donc à la main, après une rotation de secret, un
 * changement d'URL ou un doute — jamais dans un job public.
 *
 * ── Ce qu'il vérifie, et pourquoi chacune vaut une panne réelle ─────────────
 *
 *  1. Un événement correctement signé est ACCEPTÉ sur chacune des deux routes.
 *     C'est la seule preuve que le bon secret est posé sur le bon service : un
 *     `503` dirait qu'il manque, un `400` qu'il ne correspond pas.
 *
 *  2. Un événement sans `orderId` connu repart en 200. Stripe rejoue tout ce
 *     qui n'a pas reçu de 2xx pendant trois jours ; répondre 4xx à un
 *     événement qu'on choisit d'ignorer, c'est s'infliger trois jours de
 *     rejeu pour rien.
 *
 *  3. LE PIÈGE DE CONNECT : le secret du point d'entrée « compte » posé sur la
 *     route des comptes connectés est refusé. Cette confusion-là est
 *     silencieuse en production — le client paie, le restaurant encaisse, et
 *     la commande reste « en attente » sans qu'aucune erreur ne s'affiche.
 *
 *  4. Une signature falsifiée est refusée. Sans cela, n'importe qui pourrait
 *     faire basculer une commande en « payée » avec un simple `curl`.
 *
 *  5. Un événement daté d'il y a une heure est refusé. C'est la protection
 *     contre le rejeu d'une capture réseau — et, accessoirement, le seul
 *     contrôle qui détecte une horloge serveur qui dérive.
 *
 * Aucun événement envoyé ne porte d'identifiant de commande existant : le
 * script ne peut donc rien modifier, dans aucun environnement.
 *
 * Aucune dépendance : `fetch` et `node:crypto` suffisent (cible Node ≥ 24.3).
 */
import { createHmac } from 'node:crypto';

const CIBLES = {
  staging: 'https://api-staging-a5e8.up.railway.app',
  production: 'https://api-production-8949.up.railway.app',
};

const cible = process.argv[2] ?? 'staging';
const base = CIBLES[cible] ?? cible;
const secretCompte = process.env.WHSEC_COMPTE;
const secretConnect = process.env.WHSEC_CONNECT;

if (!secretCompte || !secretConnect) {
  console.error(
    'Renseignez WHSEC_COMPTE et WHSEC_CONNECT — les secrets des deux points\n' +
      'd’entrée, dans le mode correspondant à la cible (test pour staging,\n' +
      'live pour production). Ils sont dans le tableau de bord Stripe, et dans\n' +
      'les variables Railway du service `api`.',
  );
  process.exit(2);
}

/** L'en-tête `Stripe-Signature`, tel que Stripe le compose : schéma `v1`. */
const signer = (corps, secret, horodatage) =>
  `t=${horodatage},v1=${createHmac('sha256', secret).update(`${horodatage}.${corps}`).digest('hex')}`;

/** Un `payment_intent.succeeded` sans `orderId` — reconnu, puis ignoré. */
const paiement = (suffixe, compte) => ({
  id: `evt_verification_${suffixe}`,
  type: 'payment_intent.succeeded',
  ...(compte ? { account: compte } : {}),
  data: {
    object: {
      id: `pi_verification_${suffixe}`,
      amount: 1250,
      currency: 'eur',
      metadata: { origine: 'verifier-webhooks-stripe' },
    },
  },
});

const COMPTE_FICTIF = 'acct_verification_fictive';

const cas = [
  {
    titre: 'Route « compte » · signature valide → accusé de réception',
    chemin: '/public/stripe/webhook',
    evenement: paiement('compte'),
    secret: secretCompte,
    attendu: 200,
  },
  {
    titre: 'Route « comptes connectés » · signature valide → accusé de réception',
    chemin: '/public/stripe/webhook/connect',
    evenement: paiement('connecte', COMPTE_FICTIF),
    secret: secretConnect,
    attendu: 200,
  },
  {
    titre: 'Cycle de vie · account.updated d’un compte hors parc → ignoré sans erreur',
    chemin: '/public/stripe/webhook/connect',
    evenement: {
      id: 'evt_verification_compte',
      type: 'account.updated',
      account: COMPTE_FICTIF,
      data: { object: { id: COMPTE_FICTIF, charges_enabled: true } },
    },
    secret: secretConnect,
    attendu: 200,
  },
  {
    titre: 'LE PIÈGE · secret du compte posé sur la route Connect → refusé',
    chemin: '/public/stripe/webhook/connect',
    evenement: paiement('secret-croise', COMPTE_FICTIF),
    secret: secretCompte,
    attendu: 400,
  },
  {
    titre: 'Signature falsifiée → refusée',
    chemin: '/public/stripe/webhook',
    evenement: paiement('falsifie'),
    secret: secretCompte,
    signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    attendu: 400,
  },
  {
    titre: 'Rejeu daté d’il y a une heure → refusé',
    chemin: '/public/stripe/webhook',
    evenement: paiement('rejeu'),
    secret: secretCompte,
    horodatage: Math.floor(Date.now() / 1000) - 3600,
    attendu: 400,
  },
];

async function executer({ titre, chemin, evenement, secret, attendu, horodatage, signature }) {
  const corps = JSON.stringify(evenement);
  const t = horodatage ?? Math.floor(Date.now() / 1000);
  let statut;
  let detail;
  try {
    const reponse = await fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature ?? signer(corps, secret, t),
      },
      body: corps,
    });
    statut = reponse.status;
    detail = (await reponse.text()).slice(0, 160);
  } catch (erreur) {
    statut = 0;
    detail = String(erreur);
  }
  const conforme = statut === attendu;
  console.log(`${conforme ? '✅' : '❌'} ${titre}`);
  console.log(`   attendu ${attendu} · reçu ${statut} · ${detail}`);
  return conforme;
}

console.log(`Chaîne webhook Stripe — ${cible} (${base})\n`);

const resultats = [];
for (const c of cas) resultats.push(await executer(c));

const reussis = resultats.filter(Boolean).length;
console.log(`\n${reussis}/${resultats.length} vérifications concluantes.`);

if (reussis !== resultats.length) {
  console.log(
    '\nUn 503 dit que le secret manque sur ce service, ou que le déploiement est\n' +
      'antérieur à sa pose — une variable Railway n’entre dans le processus qu’au\n' +
      'redéploiement suivant. Un 400 sur les deux premiers cas dit que le secret\n' +
      'posé n’est pas celui du point d’entrée visé : ce sont les deux moitiés du\n' +
      'même diagnostic, et elles ne se soignent pas pareil.',
  );
}

process.exit(reussis === resultats.length ? 0 : 1);
