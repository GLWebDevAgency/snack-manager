import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { config as dotenv } from 'dotenv';
import * as argon2 from 'argon2';
import mongoose from 'mongoose';
import { MODELS } from './schemas';

// Même .env racine que les autres scripts du paquet (cf. `seed.ts`).
dotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * CHANGER LE MOT DE PASSE D'UN COMPTE, SANS QU'IL PASSE PAR LE CODE.
 *
 * Le seed pose des mots de passe de démarrage écrits en clair dans
 * `seed.ts` — c'est acceptable pour amorcer un environnement de
 * développement, et inacceptable en production : le compte `sm_admin` voit le
 * chiffre d'affaires de TOUS les restaurants du parc et peut en suspendre un.
 * Un secret commité part avec l'historique du dépôt, et l'effacer ensuite ne
 * l'efface pas des commits passés.
 *
 * Ce script existe pour que le vrai mot de passe ne soit JAMAIS écrit nulle
 * part : il est saisi au clavier, haché en mémoire, et seul le condensat
 * atteint la base. Il n'est ni journalisé, ni passé en argument de ligne de
 * commande (l'historique du shell le garderait), ni lu depuis un fichier.
 *
 *   pnpm --filter @sm/db exec tsx src/set-password.ts <email>
 *
 * La saisie est masquée. Le script refuse un mot de passe trop court ou
 * manifestement devinable, exige la confirmation, et n'écrit que si le compte
 * existe déjà — il ne crée personne.
 */

/** Longueur en dessous de laquelle un mot de passe d'administration ne vaut rien. */
const MIN_LENGTH = 12;

/**
 * Refus des mots de passe construits sur le produit lui-même.
 *
 * C'est exactement la faute qu'on répare : `***MOT-DE-PASSE-RETIRE***` est le nom du
 * produit suivi de l'année. Interdire ce motif évite de le remplacer par son
 * cousin.
 */
const FORBIDDEN = [/snack/i, /manager/i, /classfood/i, /class.?food/i, /motdepasse/i, /password/i];

/** Saisie masquée — rien ne s'affiche, pas même des étoiles (longueur non révélée). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const output = stdout as NodeJS.WriteStream & { muted?: boolean };
    const write = output.write.bind(output);
    // On intercepte l'écho du terminal le temps de la saisie.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!output.muted) write(s);
    };
    write(question);
    output.muted = true;
    rl.question('', (answer) => {
      output.muted = false;
      write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function complain(password: string): string | null {
  if (password.length < MIN_LENGTH) {
    return `Trop court : ${MIN_LENGTH} caractères au minimum (celui-ci en fait ${password.length}).`;
  }
  const hit = FORBIDDEN.find((pattern) => pattern.test(password));
  if (hit) {
    return "Ce mot de passe contient le nom du produit ou d'un client : c'est précisément le défaut qu'on corrige.";
  }
  return null;
}

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage : pnpm --filter @sm/db exec tsx src/set-password.ts <email>');
    process.exit(1);
  }

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant (racine .env)');

  await mongoose.connect(uri);
  const Users = mongoose.model(MODELS.User.name, MODELS.User.schema, MODELS.User.collection);

  // On vérifie l'existence AVANT de demander quoi que ce soit : rien de plus
  // agaçant que de saisir deux fois un mot de passe pour apprendre qu'on s'est
  // trompé d'adresse.
  const user = await Users.findOne({ email }).lean<{ email: string; role: string } | null>();
  if (!user) {
    console.error(`Aucun compte avec l'adresse ${email}. Rien n'a été modifié.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Compte trouvé : ${user.email} (rôle ${user.role}).`);
  if (user.role === 'sm_admin') {
    console.log("Attention : ce compte voit tous les restaurants du parc et peut les suspendre.");
  }

  const password = await askHidden('Nouveau mot de passe (saisie masquée) : ');
  const problem = complain(password);
  if (problem) {
    console.error(problem);
    await mongoose.disconnect();
    process.exit(1);
  }

  const again = await askHidden('Confirmez : ');
  if (again !== password) {
    console.error('Les deux saisies diffèrent. Rien n’a été modifié.');
    await mongoose.disconnect();
    process.exit(1);
  }

  await Users.updateOne({ email }, { $set: { passwordHash: await argon2.hash(password) } });
  await mongoose.disconnect();

  // On ne réaffiche JAMAIS le mot de passe, même pour confirmer.
  console.log(`\nMot de passe de ${email} mis à jour. Les sessions ouvertes restent valides`);
  console.log('jusqu’à leur expiration (12 h) — déconnectez-vous et reconnectez-vous pour vérifier.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
