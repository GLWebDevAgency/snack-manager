import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import * as argon2 from 'argon2';
import mongoose from 'mongoose';
import { MODELS } from './schemas';
import { askHidden, complain } from './password-prompt';

// Même .env racine que les autres scripts du paquet (cf. `seed.ts`).
dotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * CRÉER LE COMPTE ÉQUIPE (`sm_admin`) — le frère de `set-password.ts`.
 *
 * `set-password.ts` refuse par principe de créer qui que ce soit : changer un
 * mot de passe et ouvrir un accès qui voit tout le parc sont deux gestes de
 * gravités différentes, ils méritent deux scripts qu'on ne confond pas.
 * Celui-ci CRÉE (et ne modifie jamais) : si l'adresse existe déjà, il renvoie
 * vers son frère et n'écrit rien.
 *
 * Mêmes règles que lui : le mot de passe est saisi au clavier, masqué, haché
 * en mémoire — jamais en argument (l'historique du shell le garderait),
 * jamais journalisé, jamais réaffiché.
 *
 *   MONGO_URL='<URL de la base visée>' \
 *     pnpm --filter @sm/db exec tsx src/create-admin.ts <email> [nom]
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const name = process.argv[3]?.trim() ?? '';
  if (!email || !email.includes('@')) {
    console.error(
      'Usage : pnpm --filter @sm/db exec tsx src/create-admin.ts <email> [nom]',
    );
    process.exit(1);
  }

  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant (variable d’environnement ou .env racine)');

  await mongoose.connect(uri);
  const Users = mongoose.model(MODELS.User.name, MODELS.User.schema, MODELS.User.collection);

  const existing = await Users.findOne({ email }).lean<{ role: string } | null>();
  if (existing) {
    console.error(
      `Un compte existe déjà pour ${email} (rôle ${existing.role}). Pour changer son mot de passe : set-password.ts. Rien n'a été créé.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Création du compte ÉQUIPE ${email} — il verra tous les restaurants du parc.`);
  const password = await askHidden('Mot de passe (saisie masquée) : ');
  const problem = complain(password);
  if (problem) {
    console.error(problem);
    await mongoose.disconnect();
    process.exit(1);
  }
  const again = await askHidden('Confirmez : ');
  if (again !== password) {
    console.error('Les deux saisies diffèrent. Rien n’a été créé.');
    await mongoose.disconnect();
    process.exit(1);
  }

  await Users.create({
    email,
    passwordHash: await argon2.hash(password),
    role: 'sm_admin',
    tenantId: null, // null = équipe Snack Manager, pas un restaurant
    name,
  });
  await mongoose.disconnect();

  console.log(`\nCompte sm_admin ${email} créé. Connexion : /sm/login.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
