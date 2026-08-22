/**
 * LE FILET SOUS LA REMISE EN ÉTAT.
 *
 * Les deux scénarios « réel » écrivent dans une vraie base et rendent le parc
 * comme ils l'ont trouvé — mais seulement s'ils vont jusqu'au bout. Un `Ctrl-C`,
 * un job d'intégration continue annulé, un runner coupé net : le processus meurt
 * entre l'écriture et la restauration, et il ne reste RIEN pour rattraper.
 *
 * C'est arrivé pendant la mise au point de ce dossier : une exécution
 * interrompue a laissé un prix à 7,63 € sur staging. Sans trace, sans message,
 * et le scénario suivant aurait pris 7,63 € pour la valeur d'origine — la
 * dérive se serait installée à chaque exécution.
 *
 * ─── LE PRINCIPE ───
 *
 * Avant toute écriture, le scénario NOTE ICI le geste inverse. S'il termine, il
 * classe la note. S'il meurt, la note reste — et la prochaine exécution la
 * rejoue AVANT de lire quoi que ce soit. Le parc revient à son état d'origine
 * même si personne n'a rien vu.
 *
 * La note ne contient que des chemins d'API et des valeurs métier (un prix, un
 * statut de compte). Jamais un jeton, jamais un mot de passe : le fichier vit
 * dans le dépôt de travail, il doit pouvoir être lu par-dessus l'épaule.
 */
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { client } from './api.mjs';
import { RACINE, identifiants } from './env.mjs';
import { cibles } from './cibles.mjs';

const DOSSIER = resolve(RACINE, 'e2e', 'rapports');
const JOURNAL = resolve(DOSSIER, 'parc-a-remettre.json');

/**
 * Enregistre les gestes qui remettront le parc en état.
 *
 * Appelé AVANT l'écriture, jamais après : une note posée après coup ne couvre
 * pas la fenêtre pendant laquelle on peut mourir.
 *
 * @param {{acteur: 'gerant'|'equipe', methode: string, chemin: string, corps: object, decrit: string}[]} gestes
 */
export async function noterARemettre(gestes) {
  await mkdir(DOSSIER, { recursive: true });
  await writeFile(JOURNAL, JSON.stringify({ pose: new Date().toISOString(), gestes }, null, 2), 'utf8');
}

/** Le scénario est allé au bout et a rendu le parc : la note n'a plus lieu d'être. */
export async function classerJournal() {
  await rm(JOURNAL, { force: true });
}

/**
 * Rejoue une note laissée par une exécution morte en route.
 *
 * Bruyant à dessein : si quelque chose a dû être réparé, ça doit se lire dans
 * le journal d'exécution. Une réparation silencieuse serait une dérive
 * silencieuse.
 */
export async function reparerParcSiNecessaire() {
  let note;
  try {
    note = JSON.parse(await readFile(JOURNAL, 'utf8'));
  } catch {
    return false; // pas de note : le cas normal
  }

  const parc = cibles();
  const comptes = identifiants();
  if (!comptes) return false;

  const clients = new Map();
  const pour = async (acteur) => {
    if (!clients.has(acteur)) {
      const api = client(parc.api);
      await api.connexion(acteur === 'equipe' ? comptes.equipe : comptes.gerant);
      clients.set(acteur, api);
    }
    return clients.get(acteur);
  };

  console.warn(
    `   ⚠  Une exécution précédente s’est arrêtée en cours (note du ${note.pose}). Remise en état :`,
  );
  for (const geste of note.gestes) {
    const api = await pour(geste.acteur);
    const { statut } = await api.brut(geste.methode, geste.chemin, geste.corps);
    console.warn(`      · ${geste.decrit} → ${statut}`);
    if (statut < 200 || statut >= 300) {
      throw new Error(
        `Impossible de remettre le parc en état (« ${geste.decrit} » → ${statut}). ` +
          `Réglez-le à la main, puis supprimez ${JOURNAL}.`,
      );
    }
  }

  await classerJournal();
  return true;
}
