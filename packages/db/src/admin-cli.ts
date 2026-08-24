import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import * as argon2 from 'argon2';
import mongoose, { type Model } from 'mongoose';
import { MODELS } from './schemas';
import { askHidden, complain } from './password-prompt';
import { choisir, confirmer, demander, cyan, gras, gris, jaune, rouge, vert } from './cli/terminal';
import { resoudreUrlMongo, masquerUrl, type Environnement } from './cli/railway';

// Même .env racine que les autres scripts du paquet (cf. `seed.ts`).
dotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * LA CONSOLE D'ADMINISTRATION — `pnpm admin` depuis la racine du dépôt.
 *
 * Les scripts `create-admin.ts` et `set-password.ts` demandent un MONGO_URL
 * de production — que l'opérateur n'a pas sous la main et ne devrait jamais
 * coller dans un shell. Cette console fait le tour complet : elle demande
 * l'ENVIRONNEMENT (production ou staging), lit elle-même l'URL Mongo dans
 * les variables Railway (voir `cli/railway.ts` — URL publique du proxy TCP,
 * chemin de base de l'API greffé), se connecte, puis offre les gestes de
 * compte au clavier : créer le compte équipe, changer un mot de passe,
 * lister les comptes.
 *
 * Ce qui ne change JAMAIS, quels que soient l'écran et l'environnement :
 * le mot de passe est saisi masqué, haché en mémoire (argon2), jamais passé
 * en argument, jamais journalisé, jamais réaffiché — et l'URL ne s'affiche
 * que masquée. En production, chaque écriture se confirme une dernière fois.
 *
 * Préalables (une fois par poste) : la CLI Railway installée, « railway
 * login », puis « railway link » depuis ce dépôt.
 */

type Utilisateurs = Model<{
  email: string;
  passwordHash: string;
  role: string;
  tenantId: unknown;
  name: string;
}>;

/** Le modèle User, unique par processus — reconnexions comprises. */
function utilisateurs(): Utilisateurs {
  const { name, schema, collection } = MODELS.User;
  return (mongoose.models[name] as Utilisateurs) ?? mongoose.model(name, schema, collection);
}

type Cible = { titre: string; url: string; production: boolean };

/**
 * Choisir l'environnement, et en tirer l'URL — sans jamais la demander.
 * `'reessayer'` : la résolution Railway a échoué, la raison est affichée, et
 * on REVIENT au menu — une résolution ratée ne ferme pas la console alors
 * qu'une autre entrée du menu peut encore servir.
 */
async function choisirCible(): Promise<Cible | null | 'reessayer'> {
  const choix: Array<{ titre: string; valeur: 'production' | 'staging' | 'shell' | 'quitter'; detail?: string }> = [
    { titre: rouge('Production'), valeur: 'production', detail: 'la vraie base — chaque écriture se confirme' },
    { titre: jaune('Staging'), valeur: 'staging', detail: 'la base de répétition' },
  ];
  if (process.env.MONGO_URL) {
    choix.push({
      titre: 'MONGO_URL du shell',
      valeur: 'shell',
      detail: masquerUrl(process.env.MONGO_URL),
    });
  }
  choix.push({ titre: gris('Quitter'), valeur: 'quitter' });

  const reponse = await choisir('Quel environnement ?', choix);
  if (reponse === 'quitter') return null;
  if (reponse === 'shell') {
    // La console ne sait pas ce que désigne cette URL — c'est à l'opérateur
    // de dire si le garde-fou de production doit s'armer.
    const production = await confirmer('Traiter cette base comme la PRODUCTION (un feu vert avant chaque écriture) ?');
    return { titre: 'MONGO_URL du shell', url: process.env.MONGO_URL as string, production };
  }
  console.log(gris(`\nLecture des variables Railway (${reponse})…`));
  try {
    const { url, masquee, service } = resoudreUrlMongo(reponse as Environnement);
    console.log(`${vert('✓')} URL retenue : ${masquee}${service ? gris(`  (service ${service})`) : ''}`);
    return { titre: reponse, url, production: reponse === 'production' };
  } catch (cause) {
    console.log(rouge(cause instanceof Error ? cause.message : String(cause)));
    return 'reessayer';
  }
}

/** Le dernier verrou avant d'écrire en production. Ailleurs : passage direct. */
async function feuVert(cible: Cible, geste: string): Promise<boolean> {
  if (!cible.production) return true;
  const accord = await confirmer(`${rouge('PRODUCTION')} — ${geste} ?`);
  if (!accord) console.log('Rien n’a été écrit.');
  return accord;
}

/** Un mot de passe digne du compte, saisi deux fois — ou rien. */
async function saisirMotDePasse(): Promise<string | null> {
  const motDePasse = await askHidden('Mot de passe (saisie masquée) : ');
  const reproche = complain(motDePasse);
  if (reproche) {
    console.log(rouge(reproche));
    return null;
  }
  const confirmation = await askHidden('Confirmez : ');
  if (confirmation !== motDePasse) {
    console.log(rouge('Les deux saisies diffèrent. Rien n’a été écrit.'));
    return null;
  }
  return motDePasse;
}

async function creerCompteEquipe(cible: Cible): Promise<void> {
  const Users = utilisateurs();
  const email = (await demander('Adresse e-mail du compte : ')).toLowerCase();
  if (!email.includes('@')) {
    console.log(rouge('Adresse invalide.'));
    return;
  }
  const existant = await Users.findOne({ email }).lean<{ role: string } | null>();
  if (existant) {
    console.log(
      jaune(`Un compte existe déjà pour ${email} (rôle ${existant.role}) — passez par « Changer le mot de passe ».`),
    );
    return;
  }
  const nom = await demander('Nom affiché (optionnel) : ');
  console.log(gris('Ce compte équipe verra tous les restaurants du parc.'));
  const motDePasse = await saisirMotDePasse();
  if (motDePasse === null) return;
  if (!(await feuVert(cible, `créer le compte équipe ${email}`))) return;
  await Users.create({
    email,
    passwordHash: await argon2.hash(motDePasse),
    role: 'sm_admin',
    tenantId: null, // null = équipe Snack Manager, pas un restaurant
    name: nom,
  });
  console.log(vert(`\nCompte sm_admin ${email} créé. Connexion : /sm/login.\n`));
}

async function changerMotDePasse(cible: Cible): Promise<void> {
  const Users = utilisateurs();
  const email = (await demander('Adresse e-mail du compte : ')).toLowerCase();
  // L'existence se vérifie AVANT toute saisie : rien de plus agaçant que de
  // taper deux fois un mot de passe pour apprendre qu'on s'est trompé d'adresse.
  const compte = await Users.findOne({ email }).lean<{ email: string; role: string } | null>();
  if (!compte) {
    console.log(rouge(`Aucun compte avec l’adresse ${email}. Rien n’a été modifié.`));
    return;
  }
  console.log(`Compte trouvé : ${compte.email} (rôle ${compte.role}).`);
  if (compte.role === 'sm_admin') {
    console.log(jaune('Attention : ce compte voit tous les restaurants du parc et peut les suspendre.'));
  }
  const motDePasse = await saisirMotDePasse();
  if (motDePasse === null) return;
  if (!(await feuVert(cible, `changer le mot de passe de ${email}`))) return;
  await Users.updateOne({ email }, { $set: { passwordHash: await argon2.hash(motDePasse) } });
  console.log(vert(`\nMot de passe de ${email} mis à jour.`));
  console.log(gris('Les sessions ouvertes restent valides jusqu’à leur expiration (12 h).\n'));
}

async function listerComptesEquipe(): Promise<void> {
  const comptes = await utilisateurs()
    .find({ role: 'sm_admin' })
    .sort({ email: 1 })
    .lean<Array<{ email: string; name?: string; createdAt?: Date }>>();
  if (comptes.length === 0) {
    console.log(jaune('\nAucun compte équipe dans cette base — c’est le moment d’en créer un.\n'));
    return;
  }
  console.log('');
  for (const compte of comptes) {
    const depuis = compte.createdAt
      ? gris(`  créé le ${compte.createdAt.toLocaleDateString('fr-FR')}`)
      : '';
    console.log(`  ${cyan('•')} ${compte.email}${compte.name ? ` — ${compte.name}` : ''}${depuis}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  console.log(gras(cyan('\n  Snack Manager — console d’administration')));
  console.log(gris('  Comptes équipe et mots de passe, sans jamais écrire un secret nulle part.'));

  for (;;) {
    const cible = await choisirCible();
    if (cible === null) break;
    if (cible === 'reessayer') continue;

    try {
      // 8 s suffisent à dire « mauvaise URL » — les 30 s par défaut font douter.
      await mongoose.connect(cible.url, { serverSelectionTimeoutMS: 8_000 });
    } catch (cause) {
      console.log(rouge(`Connexion impossible : ${cause instanceof Error ? cause.message : String(cause)}`));
      continue;
    }
    const nombre = await utilisateurs().countDocuments({ role: 'sm_admin' });
    console.log(
      nombre === 0
        ? jaune('Connecté. Aucun compte équipe dans cette base.')
        : vert(`Connecté. ${nombre} compte${nombre > 1 ? 's' : ''} équipe dans cette base.`),
    );

    boucle: for (;;) {
      const action = await choisir(`Et maintenant ? ${gris(`(${cible.titre})`)}`, [
        { titre: 'Créer le compte équipe (sm_admin)', valeur: 'creer' as const },
        { titre: 'Changer le mot de passe d’un compte', valeur: 'motdepasse' as const },
        { titre: 'Lister les comptes équipe', valeur: 'lister' as const },
        { titre: 'Changer d’environnement', valeur: 'environnement' as const },
        { titre: gris('Quitter'), valeur: 'quitter' as const },
      ]);
      switch (action) {
        case 'creer':
          await creerCompteEquipe(cible);
          break;
        case 'motdepasse':
          await changerMotDePasse(cible);
          break;
        case 'lister':
          await listerComptesEquipe();
          break;
        case 'environnement':
          await mongoose.disconnect();
          break boucle;
        case 'quitter':
          await mongoose.disconnect();
          console.log(gris('\nÀ bientôt.\n'));
          return;
      }
    }
  }
  console.log(gris('\nÀ bientôt.\n'));
}

main().catch((error) => {
  console.error(rouge(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
