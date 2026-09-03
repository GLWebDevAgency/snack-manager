#!/usr/bin/env node
/**
 * Vérification de bonne santé après déploiement — « est-ce que le restaurant
 * peut travailler, là, maintenant ? »
 *
 *     node scripts/smoke.mjs staging
 *     node scripts/smoke.mjs production
 *
 * Ce script ne teste QUE des surfaces publiques : aucune authentification,
 * aucun jeton, aucune variable secrète. Il peut donc tourner dans un job
 * GitHub Actions qui ne reçoit AUCUN secret — c'est volontaire, et c'est ce qui
 * garantit qu'un journal d'exécution public ne peut rien laisser fuiter.
 *
 * Ce qu'il vérifie, dans l'ordre où ça compte pour un service en cours :
 *   1. l'API répond            → sans elle, ni caisse ni cuisine ;
 *   2. l'API sert LA RÉVISION ATTENDUE → voir plus bas, c'est le seul contrôle
 *                                qui AFFIRME quelque chose sur le déploiement
 *                                plutôt que sur l'environnement ;
 *   3. les surfaces publiques d'un restaurant sortent, si son slug est
 *                                configuré : carte, catalogue fidélité puis
 *                                vraie PWA fidélité ;
 *   4. les trois interfaces servent leur page — et la bonne :
 *      on ne se contente pas d'un 200, on cherche le titre attendu, sinon un
 *      « 200 » servi par une page d'erreur d'infrastructure passerait pour un
 *      succès.
 *
 * ── « Ça répond » n'est pas « c'est ma version » ─────────────────────────────
 *
 * Un contrôle qui constate qu'il y a quelque chose qui répond ne distingue pas
 * un déploiement réussi d'un déploiement raté dont l'ANCIENNE version continue
 * de servir — le cas le plus fréquent chez Railway, et le plus trompeur.
 *
 * Depuis que `GET /health` publie son SHA (`apps/api/src/modules/health/`), on
 * peut trancher. Renseignez `SM_REVISION_ATTENDUE` :
 *
 *     SM_REVISION_ATTENDUE=$(git rev-parse HEAD) node scripts/smoke.mjs staging
 *
 * `deploy.yml` la pose à `github.sha`, et SEULEMENT si la mise en ligne a
 * réussi : quand elle a échoué, l'ancienne version sert forcément, et rougir
 * là-dessus masquerait la seule information utile du moment — « le restaurant
 * peut-il encaisser ? ». Sans la variable, le contrôle s'annonce IGNORÉ, la
 * révision servie reste AFFICHÉE, et rien n'est affirmé.
 *
 * Aucune dépendance : `fetch` et `node:crypto` suffisent (cible Node ≥ 24.3).
 *
 * Voir docs/CI-CD.md § 11.
 */

import { createHash } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Les cibles
//
// Ces adresses sont PUBLIQUES — ce sont celles qu'un client tape dans son
// navigateur. Les écrire ici n'est pas une fuite, c'est une documentation
// exécutable. Elles sont surchargeables par variable d'environnement pour
// pouvoir viser un domaine personnalisé sans toucher au script.
// ─────────────────────────────────────────────────────────────────────────────
const CIBLES = {
  staging: {
    api: 'https://api-staging-a5e8.up.railway.app',
    web: 'https://web-staging-6f5f.up.railway.app',
    pos: 'https://pos-staging-7f92.up.railway.app',
    kds: 'https://kds-staging-90da.up.railway.app',
    // Établissement de démonstration semé par `pnpm seed`.
    slugCarte: 'classfood',
  },
  production: {
    api: 'https://api-production-8949.up.railway.app',
    web: 'https://web-production-99b58c.up.railway.app',
    pos: 'https://pos-production-a9d8.up.railway.app',
    kds: 'https://kds-production-8991.up.railway.app',
    // ⚠️ VIDE À DESSEIN, ce n'est pas un oubli.
    // La base de production a été remise à blanc (commit 7b1c6dc) : il n'y a
    // aujourd'hui AUCUN établissement, donc aucune carte publique à servir.
    // Le contrôle est alors annoncé « IGNORÉ », bruyamment, plutôt que rouge
    // pour une raison qui n'est pas une panne.
    // Le jour où le premier restaurant est en ligne : mettre son slug ici (ou
    // exporter SM_SLUG_CARTE) et le contrôle redevient réel. Voir § 11.
    slugCarte: '',
  },
};

const CONTROLES_INTERFACES = [
  { cle: 'web', nom: 'Commande en ligne + back-office', marqueur: /<title>[^<]*Snack Manager/i },
  { cle: 'pos', nom: 'Caisse', marqueur: /<title>[^<]*Snack Manager\s*—\s*Caisse/i },
  { cle: 'kds', nom: 'Écran cuisine', marqueur: /<title>[^<]*Snack Manager\s*—\s*Cuisine/i },
];

// Une interface qui vient d'être redéployée peut mettre quelques secondes à
// accepter sa première requête (démarrage du processus, bascule du routeur
// Railway). On réessaie, mais pas éternellement : au-delà, c'est une panne.
const TENTATIVES = Number(process.env.SM_TENTATIVES ?? 8);
const ATTENTE_MS = Number(process.env.SM_ATTENTE_MS ?? 8000);
const DELAI_REQUETE_MS = Number(process.env.SM_DELAI_REQUETE_MS ?? 15000);

// La révision qu'on s'attend à voir servie — un SHA de commit, jamais une
// valeur confidentielle. Vide = on n'affirme rien (voir l'en-tête).
const REVISION_ATTENDUE = (process.env.SM_REVISION_ATTENDUE ?? '').trim();

const DANS_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

// ─────────────────────────────────────────────────────────────────────────────

function usage(message) {
  console.error(`✗ ${message}

Usage :
    node scripts/smoke.mjs <staging|production>

Surcharges facultatives (aucune n'est confidentielle) :
    SM_URL_API   SM_URL_WEB   SM_URL_POS   SM_URL_KDS   SM_SLUG_CARTE
    SM_SLUG_CARTE_PRODUCTION — slug public de production ; vide = contrôles tenant ignorés
    SM_REVISION_ATTENDUE — le SHA que l'API doit servir ; vide = on n'affirme rien
    SM_TENTATIVES (${TENTATIVES})   SM_ATTENTE_MS (${ATTENTE_MS})   SM_DELAI_REQUETE_MS (${DELAI_REQUETE_MS})
`);
  process.exit(2);
}

function resoudreCible() {
  const nom = (process.argv[2] ?? '').trim();
  if (!nom) usage('Environnement manquant.');
  const base = CIBLES[nom];
  if (!base) usage(`Environnement « ${nom} » inconnu — attendu : staging ou production.`);

  const slugConfigure =
    process.env.SM_SLUG_CARTE ??
    (nom === 'production' ? process.env.SM_SLUG_CARTE_PRODUCTION : undefined) ??
    base.slugCarte;

  return {
    nom,
    api: process.env.SM_URL_API || base.api,
    web: process.env.SM_URL_WEB || base.web,
    pos: process.env.SM_URL_POS || base.pos,
    kds: process.env.SM_URL_KDS || base.kds,
    slugCarte: slugConfigure.trim(),
  };
}

/** Empreinte courte du corps servi — permet de voir d'un coup d'œil si une
 *  surface sert autre chose qu'avant le déploiement. */
function empreinte(texte) {
  return createHash('sha256').update(texte).digest('hex').slice(0, 12);
}

async function requete(url) {
  const debut = Date.now();
  const reponse = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'snack-manager-smoke/1' },
    signal: AbortSignal.timeout(DELAI_REQUETE_MS),
  });
  const corps = await reponse.text();
  return { statut: reponse.status, corps, ms: Date.now() - debut };
}

/**
 * Rejoue `verifier` jusqu'à ce qu'il rende `null` (succès) ou que les essais
 * soient épuisés. `verifier` rend une chaîne décrivant le défaut, ou lève.
 */
async function avecReessais(verifier) {
  let dernier = 'jamais exécuté';
  for (let essai = 1; essai <= TENTATIVES; essai += 1) {
    try {
      const defaut = await verifier();
      if (!defaut) return null;
      dernier = defaut;
    } catch (erreur) {
      dernier = erreur?.name === 'TimeoutError' ? `pas de réponse en ${DELAI_REQUETE_MS} ms` : String(erreur?.message ?? erreur);
    }
    if (essai < TENTATIVES) {
      process.stdout.write(`    … essai ${essai}/${TENTATIVES} : ${dernier} — nouvelle tentative dans ${ATTENTE_MS / 1000} s\n`);
      await new Promise((resoudre) => setTimeout(resoudre, ATTENTE_MS));
    }
  }
  return dernier;
}

// ─── Les contrôles ───────────────────────────────────────────────────────────

/**
 * Lit `GET /health` et rend `{ charge, ms }`, ou `{ defaut }` décrivant ce qui
 * cloche. Les deux contrôles qui suivent partent de là — deux appels distincts,
 * volontairement : chacun réessaie pour son propre compte, et une API qui
 * répond une fois sur deux doit se voir.
 */
async function lireSante(url) {
  const { statut, corps, ms } = await requete(url);
  if (statut !== 200) return { defaut: `HTTP ${statut}` };
  let charge;
  try {
    charge = JSON.parse(corps);
  } catch {
    return { defaut: `réponse non-JSON : ${corps.slice(0, 120)}` };
  }
  if (charge.ok !== true) return { defaut: `charge inattendue : ${corps.slice(0, 120)}` };
  if (charge.service !== 'snack-manager-api') return { defaut: `ce n'est pas notre API : service=${charge.service}` };
  return { charge, ms };
}

/** Le SHA publié par l'API, ou '' — une valeur vide compte comme absente. */
function revisionDe(charge) {
  return typeof charge.revision === 'string' ? charge.revision.trim() : '';
}

function controleApi(cible) {
  const url = `${cible.api}/health`;
  return {
    nom: "L'API répond",
    url,
    executer: async (detail) => {
      const { defaut, charge, ms } = await lireSante(url);
      if (defaut) return defaut;
      detail.push(`${ms} ms`);
      // Affichée dans TOUS les cas, même quand on n'a rien à comparer : le jour
      // où une mise en ligne échoue, c'est cette ligne qui dit ce qui sert.
      const servie = revisionDe(charge);
      detail.push(servie ? `révision ${servie.slice(0, 7)}` : '⚠ aucune révision publiée');
      if (charge.deploiement) detail.push(`déploiement ${String(charge.deploiement).slice(0, 8)}`);
      return null;
    },
  };
}

/**
 * LE SEUL CONTRÔLE QUI PARLE DU DÉPLOIEMENT.
 *
 * Tous les autres décrivent l'environnement : ils seraient verts avec la
 * version d'avant en ligne. Celui-ci compare le SHA servi à celui qu'on vient
 * de pousser, et c'est ce qui transforme « il y a quelque chose qui répond » en
 * « c'est bien ma révision qui répond ».
 */
function controleRevision(cible) {
  const url = `${cible.api}/health`;
  const nom = "L'API sert la révision attendue";

  if (!REVISION_ATTENDUE) {
    return {
      nom,
      url,
      ignore:
        "aucune révision attendue (SM_REVISION_ATTENDUE vide) — sans elle ce contrôle " +
        'ne peut qu\'observer, pas affirmer ; la révision servie reste affichée ci-dessus',
    };
  }

  return {
    nom,
    url,
    executer: async (detail) => {
      const { defaut, charge } = await lireSante(url);
      if (defaut) return defaut;

      const servie = revisionDe(charge);
      if (!servie) {
        return (
          "l'API ne publie aucune révision : SM_REVISION n'est pas posée sur le service " +
          'Railway, ou le conteneur en service est antérieur à la route qui la publie ' +
          '(voir docs/CI-CD.md § 11)'
        );
      }
      if (servie !== REVISION_ATTENDUE) {
        return (
          `révision servie ${servie.slice(0, 7)} ≠ attendue ${REVISION_ATTENDUE.slice(0, 7)} — ` +
          "la mise en ligne n'a pas pris : c'est une AUTRE version qui sert"
        );
      }
      detail.push(`${servie.slice(0, 7)} — c'est bien la révision poussée`);
      return null;
    },
  };
}

function controleCarte(cible) {
  if (!cible.slugCarte) {
    return {
      nom: 'La carte publique se sert',
      url: '—',
      ignore:
        `aucun slug d'établissement configuré pour « ${cible.nom} » ` +
        '(voir scripts/smoke.mjs → CIBLES et docs/CI-CD.md § 11)',
    };
  }
  const url = `${cible.api}/public/tenants/${encodeURIComponent(cible.slugCarte)}/menu`;
  return {
    nom: 'La carte publique se sert',
    url,
    executer: async (detail) => {
      const { statut, corps, ms } = await requete(url);
      if (statut !== 200) return `HTTP ${statut} — ${corps.slice(0, 160)}`;
      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        return `réponse non-JSON : ${corps.slice(0, 120)}`;
      }
      if (!Array.isArray(charge.categories)) return 'charge sans tableau « categories »';
      const nbProduits = charge.categories.reduce((somme, c) => somme + (c.products?.length ?? 0), 0);
      if (charge.categories.length === 0) {
        // La lecture traverse bien Mongo : ce n'est pas une panne, mais une
        // carte vide sur un restaurant en service se remarque.
        detail.push('⚠ carte vide (0 catégorie)');
      }
      detail.push(`${charge.categories.length} catégories · ${nbProduits} produits · ${ms} ms`);
      return null;
    },
  };
}

function controleCatalogueFidelite(cible) {
  if (!cible.slugCarte) {
    return {
      nom: 'Le catalogue fidélité public se sert',
      url: '—',
      ignore:
        `aucun slug d'établissement configuré pour « ${cible.nom} » ` +
        '(voir scripts/smoke.mjs → CIBLES et docs/CI-CD.md § 11)',
    };
  }
  const url = `${cible.api}/public/tenants/${encodeURIComponent(cible.slugCarte)}/loyalty`;
  return {
    nom: 'Le catalogue fidélité public se sert',
    url,
    executer: async (detail) => {
      const { statut, corps, ms } = await requete(url);
      if (statut !== 200) return `HTTP ${statut} — ${corps.slice(0, 160)}`;
      let charge;
      try {
        charge = JSON.parse(corps);
      } catch {
        return `réponse non-JSON : ${corps.slice(0, 120)}`;
      }
      if (charge?.restaurant?.slug !== cible.slugCarte) {
        return `restaurant inattendu : slug=${String(charge?.restaurant?.slug)}`;
      }
      if (
        typeof charge?.program?.name !== 'string' ||
        charge.program.name.trim().length === 0 ||
        !['points', 'stamps'].includes(charge.program.mechanism) ||
        typeof charge.program.unitLabelSingular !== 'string' ||
        typeof charge.program.unitLabelPlural !== 'string'
      ) {
        return 'charge sans programme fidélité public valide';
      }
      if (!Array.isArray(charge.rewards)) return 'charge sans tableau « rewards »';
      const recompenseInvalide = charge.rewards.some(
        (reward) =>
          typeof reward?.id !== 'string' ||
          typeof reward?.name !== 'string' ||
          !Number.isInteger(reward?.costUnits) ||
          reward.costUnits <= 0,
      );
      if (recompenseInvalide) return 'charge avec une récompense publique invalide';
      if (charge.rewards.length === 0) detail.push('⚠ aucune récompense active');
      detail.push(
        `${charge.program.mechanism} · ${charge.rewards.length} récompense(s) · ${ms} ms`,
      );
      return null;
    },
  };
}

function controlePwaFidelite(cible) {
  if (!cible.slugCarte) {
    return {
      nom: 'La PWA fidélité publique se sert',
      url: '—',
      ignore:
        `aucun slug d'établissement configuré pour « ${cible.nom} » ` +
        '(voir scripts/smoke.mjs → CIBLES et docs/CI-CD.md § 11)',
    };
  }
  const url = `${cible.web}/r/${encodeURIComponent(cible.slugCarte)}/fidelite`;
  return {
    nom: 'La PWA fidélité publique se sert',
    url,
    executer: async (detail) => {
      const { statut, corps, ms } = await requete(url);
      if (statut !== 200) return `HTTP ${statut}`;
      const titre = corps.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '';
      if (!titre) return 'page servie sans titre fidélité';
      if (/programme fidélité indisponible/i.test(titre)) {
        return 'la page de repli « Programme fidélité indisponible » est servie';
      }
      if (!/Chargement de votre carte fidélité|Afficher ma carte/i.test(corps)) {
        return 'page servie sans marqueur de la carte fidélité';
      }
      detail.push(`${ms} ms · empreinte ${empreinte(corps)}`);
      return null;
    },
  };
}

function controleInterface(cible, { cle, nom, marqueur }) {
  const url = `${cible[cle]}/`;
  return {
    nom: `${nom} (${cle})`,
    url,
    executer: async (detail) => {
      const { statut, corps, ms } = await requete(url);
      if (statut !== 200) return `HTTP ${statut}`;
      if (!marqueur.test(corps)) {
        // Un 200 ne suffit pas : une page d'erreur d'infrastructure en rend un
        // aussi. On exige le titre de NOTRE application.
        return `page servie mais ce n'est pas ${nom} (titre attendu absent) — ${corps.slice(0, 120).replace(/\s+/g, ' ')}`;
      }
      detail.push(`${ms} ms · empreinte ${empreinte(corps)}`);
      return null;
    },
  };
}

// ─── Exécution ───────────────────────────────────────────────────────────────

async function principal() {
  const cible = resoudreCible();

  console.log(`\n▶ Vérification de bonne santé — ${cible.nom}\n`);

  const controles = [
    controleApi(cible),
    controleRevision(cible),
    controleCarte(cible),
    controleCatalogueFidelite(cible),
    controlePwaFidelite(cible),
    ...CONTROLES_INTERFACES.map((i) => controleInterface(cible, i)),
  ];

  const resultats = [];
  for (const controle of controles) {
    if (controle.ignore) {
      console.log(`  ◌ ${controle.nom} — IGNORÉ : ${controle.ignore}`);
      if (DANS_ACTIONS) {
        console.log(`::warning title=Contrôle ignoré::${controle.nom} — ${controle.ignore}`);
      }
      resultats.push({ nom: controle.nom, etat: 'IGNORÉ', detail: controle.ignore, url: controle.url });
      continue;
    }

    console.log(`  · ${controle.nom} → ${controle.url}`);
    const detail = [];
    const defaut = await avecReessais(() => controle.executer(detail));

    if (defaut) {
      console.log(`  ✗ ${controle.nom} — ${defaut}`);
      if (DANS_ACTIONS) {
        console.log(`::error title=Santé ${cible.nom} — ${controle.nom}::${controle.url} : ${defaut}`);
      }
      resultats.push({ nom: controle.nom, etat: 'ÉCHEC', detail: defaut, url: controle.url });
    } else {
      const texte = detail.join(' · ') || 'ok';
      console.log(`  ✓ ${controle.nom} — ${texte}`);
      resultats.push({ nom: controle.nom, etat: 'OK', detail: texte, url: controle.url });
    }
  }

  const echecs = resultats.filter((r) => r.etat === 'ÉCHEC');
  const ignores = resultats.filter((r) => r.etat === 'IGNORÉ');

  await ecrireResume(cible, resultats, echecs, ignores);

  console.log('');
  if (echecs.length > 0) {
    console.log(`✗ ${echecs.length} contrôle(s) en échec sur ${cible.nom} — le déploiement est DÉCLARÉ EN ÉCHEC.`);
    console.log('  Le code est en ligne malgré tout : Railway ne défait rien tout seul.');
    console.log('  Retour arrière → docs/CI-CD.md § 12.');
    process.exitCode = 1;
    return;
  }
  console.log(
    `✓ ${cible.nom} en bonne santé — ${resultats.length - ignores.length} contrôle(s) verts` +
      (ignores.length ? `, ${ignores.length} ignoré(s)` : '') +
      '.',
  );
}

async function ecrireResume(cible, resultats, echecs, ignores) {
  const fichier = process.env.GITHUB_STEP_SUMMARY;
  if (!fichier) return;
  const { appendFile } = await import('node:fs/promises');

  const icone = { OK: '✅', ÉCHEC: '❌', IGNORÉ: '⚪️' };
  const lignes = [
    `### Santé après déploiement — \`${cible.nom}\``,
    '',
    echecs.length > 0
      ? `❌ **${echecs.length} contrôle(s) en échec.** Le code est en ligne : voir le retour arrière, \`docs/CI-CD.md\` § 12.`
      : `✅ Les ${resultats.length - ignores.length} contrôles bloquants sont verts.`,
    '',
    '| | Contrôle | Résultat | Surface |',
    '|---|---|---|---|',
    ...resultats.map((r) => `| ${icone[r.etat]} | ${r.nom} | ${r.detail} | \`${r.url}\` |`),
    '',
  ];
  await appendFile(fichier, lignes.join('\n'), 'utf8');
}

principal().catch((erreur) => {
  console.error(`✗ La vérification s'est interrompue : ${erreur?.stack ?? erreur}`);
  if (DANS_ACTIONS) {
    console.log(`::error title=Santé — interruption::${erreur?.message ?? erreur}`);
  }
  process.exitCode = 1;
});
