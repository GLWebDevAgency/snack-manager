/**
 * LECTURE DU `.env` RACINE, SANS DÉPENDANCE.
 *
 * Seuls les scénarios « réel » en ont besoin : ils se connectent à une vraie
 * API, donc avec de vrais identifiants. Ces identifiants ne sont écrits NULLE
 * PART dans ce dossier — ni valeur par défaut, ni exemple, ni journal. Ils
 * viennent de l'environnement, et l'environnement vient d'ici en local, des
 * secrets GitHub en intégration continue.
 *
 * Pourquoi une lecture maison plutôt que `--env-file-if-exists` : le lanceur
 * est aussi importé par les tests et centralise ici la règle de priorité des
 * variables, sans dépendre de la façon exacte dont chaque processus Node 24 a
 * été démarré.
 *
 * Règle qui ne bouge pas : l'ENVIRONNEMENT DÉJÀ POSÉ GAGNE TOUJOURS. En CI, les
 * secrets sont dans `process.env` et aucun `.env` n'existe ; en local, le `.env`
 * remplit les trous. Jamais l'inverse.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt, déduite de l'emplacement de ce fichier (`e2e/socle/`). */
export const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let charge = false;

/**
 * Verse le `.env` racine dans `process.env` pour les clés absentes.
 *
 * Idempotent : appelable depuis chaque fichier de test sans se soucier de
 * l'ordre, `node --test` exécutant chaque fichier dans son propre processus.
 */
export function chargerEnv() {
  if (charge) return;
  charge = true;

  let brut;
  try {
    brut = readFileSync(resolve(RACINE, '.env'), 'utf8');
  } catch {
    return; // pas de fichier : c'est le cas normal en intégration continue
  }

  for (const ligne of brut.split('\n')) {
    const propre = ligne.trim();
    if (!propre || propre.startsWith('#')) continue;
    const egal = propre.indexOf('=');
    if (egal === -1) continue;
    const cle = propre.slice(0, egal).trim();
    if (!cle || cle in process.env) continue;
    let valeur = propre.slice(egal + 1).trim();
    // Guillemets d'entourage seulement — on ne déséchappe rien d'autre : ce
    // fichier lit des mots de passe, pas un langage de gabarits.
    if (valeur.length >= 2 && /^(".*"|'.*')$/s.test(valeur)) valeur = valeur.slice(1, -1);
    process.env[cle] = valeur;
  }
}

/**
 * Première valeur NON VIDE parmi celles proposées.
 *
 * `??` ne suffit pas ici, et la nuance a des conséquences : une variable
 * GitHub jamais définie n'arrive pas « absente » dans l'environnement, elle
 * arrive VIDE. Avec `??`, la chaîne vide gagne contre la valeur par défaut,
 * et le scénario tente une connexion sans adresse — un 401 incompréhensible
 * là où on attendait un « ignoré » explicite.
 */
const premier = (...valeurs) => valeurs.find((v) => typeof v === 'string' && v.trim() !== '') ?? '';

/**
 * Identifiants du parc, ou `null` si l'un manque.
 *
 * `null` n'est pas une erreur : c'est la réponse attendue sur une pull request
 * d'un contributeur extérieur, où aucun secret n'est disponible. Les scénarios
 * concernés s'annoncent alors IGNORÉS, jamais rouges — un rouge qui ne désigne
 * pas une panne apprend à ignorer le rouge.
 */
export function identifiants() {
  chargerEnv();
  const equipe = {
    email: premier(process.env.SM_E2E_EMAIL_EQUIPE, 'admin@snackmanager.fr'),
    motDePasse: premier(process.env.SM_E2E_MDP_EQUIPE, process.env.SEED_ADMIN_PASSWORD),
  };
  const gerant = {
    email: premier(process.env.SM_E2E_EMAIL_GERANT, 'limame19@gmail.com'),
    motDePasse: premier(
      process.env.SM_E2E_MDP_GERANT,
      process.env.CAPTURE_OWNER_PASSWORD,
      process.env.SEED_OWNER_PASSWORD,
    ),
  };
  if (!equipe.motDePasse || !gerant.motDePasse) return null;
  return { equipe, gerant };
}

/**
 * Raison lisible d'un saut, ou `null` si tout est réuni.
 *
 * Le message dit QUOI faire pour que le scénario tourne — un « ignoré » muet
 * finit par être pris pour un succès.
 */
export function raisonDeSauter(cibles) {
  if (!cibles.slug) {
    return `aucun établissement sur « ${cibles.nom} » — rien à suspendre ni à retarifer (voir e2e/socle/cibles.mjs)`;
  }
  if (!identifiants()) {
    return 'identifiants absents — posez SEED_ADMIN_PASSWORD et CAPTURE_OWNER_PASSWORD (.env racine en local, secrets du dépôt en CI)';
  }
  return null;
}
