/**
 * Socle des scripts de simulation — Snack Manager
 *
 * ── Pourquoi ce fichier existe ──────────────────────────────────────────────
 *
 * Le dépôt savait déjà fabriquer de l'activité : `packages/db/src/seed-orders.ts`
 * écrit des commandes par `insertMany`, directement dans Mongo. C'est rapide,
 * et ça ne prouve rien — aucune validation Zod, aucun calcul de prix serveur,
 * aucune règle métier, aucun webhook. Une base peut être pleine de commandes
 * qu'aucune route n'aurait jamais acceptées.
 *
 * Ici, tout passe par HTTP, exactement comme le front. Une simulation qui
 * traverse les mêmes routes qu'un vrai client découvre ce qu'un `insertMany`
 * ne peut pas découvrir : un champ requis oublié, un ordre imposé, une
 * validation trop stricte, un webhook qui n'arrive pas.
 *
 * ── Ce que ce socle garantit ────────────────────────────────────────────────
 *
 *  1. UNE session, gardée douze heures. `/auth/login` et `/auth/pin` partagent
 *     dix essais par minute et par IP — le garde est posé sur la classe du
 *     contrôleur. Un script de deux jours qui se reconnecte à chaque appel
 *     prend ce mur avant d'avoir passé sa dixième commande. Le jeton est donc
 *     mis en cache, et relu seulement sur 401.
 *
 *  2. Le CORPS est lu avant de conclure. Une commande passée sur un
 *     établissement en pause répond 201 avec `{ paused: true }` : juger sur le
 *     seul code HTTP, c'est croire avoir créé cent commandes et n'en avoir
 *     créé aucune.
 *
 *  3. Un journal sur disque. Le `trackingToken` d'une commande n'est rendu
 *     qu'une fois, à la création, et aucune route ne le relit. Sans journal,
 *     une exécution interrompue laisse des commandes qu'on ne peut plus ni
 *     suivre, ni faire avancer, ni annuler.
 *
 *  4. Aucun secret dans la sortie. Les jetons et mots de passe ne sont jamais
 *     affichés, même tronqués — un préfixe de jeton reste une moitié de
 *     secret, et ces journaux finissent dans des tickets.
 *
 * Aucune dépendance : `fetch` et `node:crypto` suffisent (Node ≥ 20).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ICI, '..', '..');

/** Les cibles, en dur et surchargeables — même convention que `smoke.mjs`. */
export const CIBLES = {
  staging: {
    api: 'https://api-staging-a5e8.up.railway.app',
    web: 'https://staging.snackmanager.fr',
  },
  production: {
    api: 'https://api-production-8949.up.railway.app',
    web: 'https://app.snackmanager.fr',
  },
};

const DELAI_REQUETE_MS = 20_000;

/**
 * La production n'est pas un terrain de jeu. Le refus est ici, dans le socle,
 * et non dans chaque script : un garde-fou qu'on peut oublier de recopier
 * n'est pas un garde-fou.
 */
export function resoudreCible(nom) {
  const cible = CIBLES[nom];
  if (!cible) {
    throw new Error(`Environnement « ${nom} » inconnu — attendu : staging.`);
  }
  if (nom === 'production' && process.env.SM_SIMULATION_PRODUCTION !== 'oui-je-sais-ce-que-je-fais') {
    throw new Error(
      'La simulation refuse de viser la production : elle crée de vraies commandes, ' +
        'de vrais paiements et de vraies lignes de statistiques.',
    );
  }
  return {
    nom,
    api: process.env.SM_URL_API || cible.api,
    web: process.env.SM_URL_WEB || cible.web,
  };
}

/**
 * Les identifiants viennent du `.env` racine — jamais d'un argument de ligne
 * de commande, qui se retrouverait dans l'historique du terminal et dans la
 * liste des processus de la machine.
 */
export function lireEnv() {
  const chemin = join(RACINE, '.env');
  if (!existsSync(chemin)) return {};
  const valeurs = {};
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const nette = ligne.trim();
    if (!nette || nette.startsWith('#')) continue;
    const egal = nette.indexOf('=');
    if (egal < 1) continue;
    valeurs[nette.slice(0, egal).trim()] = nette.slice(egal + 1).trim().replace(/^["']|["']$/g, '');
  }
  return valeurs;
}

// ─── Les appels ──────────────────────────────────────────────────────────────

/**
 * Un appel HTTP qui rend TOUJOURS le corps, même sur erreur. Les messages de
 * l'API sont écrits pour être lus — `{"message":["lines.0.qty doit être ≥ 1"]}`
 * dit exactement quoi corriger, là où « HTTP 400 » n'apprend rien.
 */
export async function appel(cible, methode, chemin, { corps, jeton, entetes } = {}) {
  const url = chemin.startsWith('http') ? chemin : `${cible.api}${chemin}`;
  const debut = Date.now();
  const reponse = await fetch(url, {
    method: methode,
    headers: {
      'user-agent': 'snack-manager-simulation/1',
      ...(corps !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      ...entetes,
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(DELAI_REQUETE_MS),
  });
  const texte = await reponse.text();
  let charge = null;
  try {
    charge = texte ? JSON.parse(texte) : null;
  } catch {
    charge = null;
  }
  return { statut: reponse.status, charge, texte, ms: Date.now() - debut };
}

/** Lève avec le message de l'API plutôt qu'avec un code nu. */
export function exigerSucces(reponse, quoi) {
  if (reponse.statut >= 200 && reponse.statut < 300) return reponse.charge;
  const message = reponse.charge?.message ?? reponse.texte?.slice(0, 300) ?? '';
  throw new Error(`${quoi} — HTTP ${reponse.statut} : ${Array.isArray(message) ? message.join(' · ') : message}`);
}

// ─── Les jetons ──────────────────────────────────────────────────────────────

const cacheJetons = new Map();

/**
 * Un jeton par identité, gardé en mémoire. Le paramètre `forcer` sert au
 * rattrapage sur 401 : douze heures de validité couvrent une simulation de
 * deux jours, mais un redéploiement qui change `JWT_SECRET` les invalide tous.
 */
export async function jetonUtilisateur(cible, email, motDePasse, { forcer = false } = {}) {
  const clef = `user:${email}`;
  if (!forcer && cacheJetons.has(clef)) return cacheJetons.get(clef);
  const reponse = await appel(cible, 'POST', '/auth/login', { corps: { email, password: motDePasse } });
  if (reponse.statut === 429) {
    throw new Error(
      'Trop de connexions (10/min/IP, garde partagé entre /auth/login et /auth/pin). ' +
        'Réutilisez le jeton au lieu de vous reconnecter.',
    );
  }
  const charge = exigerSucces(reponse, `connexion de ${email}`);
  cacheJetons.set(clef, charge.token);
  return charge.token;
}

/** Le jeton d'une tablette : rôle `gerant`, `caisse` ou `cuisine`. */
export async function jetonStaff(cible, tenantSlug, pin, { forcer = false } = {}) {
  const clef = `staff:${tenantSlug}:${pin}`;
  if (!forcer && cacheJetons.has(clef)) return cacheJetons.get(clef);
  const charge = exigerSucces(
    await appel(cible, 'POST', '/auth/pin', { corps: { tenantSlug, pin } }),
    `connexion PIN sur ${tenantSlug}`,
  );
  cacheJetons.set(clef, charge.token);
  return charge.token;
}

/**
 * Rejoue `action` une fois si l'API répond 401 — le jeton a expiré ou le
 * secret a changé sous nos pieds. Au-delà, c'est un vrai problème de droits
 * et le réessai ne ferait que le masquer.
 */
export async function avecJetonFrais(obtenirJeton, action) {
  let jeton = await obtenirJeton(false);
  let reponse = await action(jeton);
  if (reponse.statut === 401) {
    jeton = await obtenirJeton(true);
    reponse = await action(jeton);
  }
  return reponse;
}

// ─── La cadence ──────────────────────────────────────────────────────────────

/**
 * `POST /public/tenants/:slug/orders` est plafonné à 20 par minute et par IP,
 * et `trust proxy` est armé : c'est la vraie adresse du poste qui compte, pas
 * celle du proxy. Une pause de trois secondes tient la cadence sous la moitié
 * du plafond, ce qui laisse de la place à un humain qui commande en même temps
 * depuis le même réseau.
 */
export const cadence = (ms = 3_000) => new Promise((resoudre) => setTimeout(resoudre, ms));

// ─── La sortie ───────────────────────────────────────────────────────────────

const SOUS_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

export const dire = {
  etape: (texte) => process.stdout.write(`  · ${texte}\n`),
  ok: (texte) => process.stdout.write(`  ✓ ${texte}\n`),
  ignore: (texte) => process.stdout.write(`  ◌ ${texte}\n`),
  echec: (texte) => {
    process.stdout.write(`  ✗ ${texte}\n`);
    if (SOUS_ACTIONS) process.stdout.write(`::error::${texte}\n`);
  },
  titre: (texte) => process.stdout.write(`\n${texte}\n`),
};

// ─── Le journal ──────────────────────────────────────────────────────────────

/**
 * Le `trackingToken` n'est rendu qu'à la création et aucune route ne le relit :
 * sans ce journal, une exécution interrompue laisse derrière elle des commandes
 * qu'on ne peut plus suivre, faire avancer, ni annuler. Le format est du JSONL
 * — une ligne par commande, ajoutée à mesure : un script tué au milieu laisse
 * un fichier lisible, là où un JSON écrit à la fin ne laisse rien.
 */
export function ouvrirJournal(nom) {
  const dossier = join(RACINE, '.simulation');
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true });
  const chemin = join(dossier, `${nom}.jsonl`);
  return {
    chemin,
    ecrire(entree) {
      appendFileSync(chemin, `${JSON.stringify(entree)}\n`, 'utf8');
    },
    lire() {
      if (!existsSync(chemin)) return [];
      return readFileSync(chemin, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((ligne) => {
          try {
            return JSON.parse(ligne);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
  };
}

// ─── L'aléa reproductible ────────────────────────────────────────────────────

/**
 * `Math.random()` rend une simulation irreproductible : quand une commande
 * casse, on ne peut pas rejouer exactement la même. Ce générateur (mulberry32)
 * prend une graine, tient dans six lignes et suffit largement — on simule un
 * service de snack, pas une loi de probabilité.
 */
export function alea(graine) {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const entre = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1));
export const parmi = (rnd, tableau) => tableau[Math.floor(rnd() * tableau.length)];
export const chance = (rnd, probabilite) => rnd() < probabilite;

/** Un tirage pondéré : `[[valeur, poids], …]`. */
export function pondere(rnd, paires) {
  const total = paires.reduce((n, [, poids]) => n + poids, 0);
  let seuil = rnd() * total;
  for (const [valeur, poids] of paires) {
    seuil -= poids;
    if (seuil <= 0) return valeur;
  }
  return paires[paires.length - 1][0];
}
