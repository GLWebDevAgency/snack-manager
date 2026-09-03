import { z } from 'zod';
import { type Formule } from './capacites';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PLUSIEURS COMPTES PAR RESTAURANT — le modèle, et ce qu'il n'est pas.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── LE CONSTAT QUI OUVRE CE FICHIER ───
 *
 * Un restaurant avait EXACTEMENT UN compte à mot de passe : celui du
 * propriétaire, fabriqué à la signature (`ConversionService.convert`). Les
 * membres de « Équipe » n'en sont pas — ce sont des porteurs de code à quatre
 * chiffres, sans e-mail, qui n'existent que derrière une tablette appairée
 * (`STAFF_ROLES`). Conséquence mesurable : un cogérant travaillait avec le mot
 * de passe du patron, et le registre des gestes sensibles enregistrait le
 * patron pour des gestes qu'il n'avait pas faits. Un registre qui nomme la
 * mauvaise personne est pire qu'un registre vide : il se défend en contrôle.
 *
 * ─── DEUX RÔLES DE PLUS, ET DEUX SEULEMENT ───
 *
 * `owner` existe et ne bouge pas. `cogerant` porte tout l'opérationnel ;
 * `comptable` ne lit que l'argent. Un troisième rôle — « manager de service »,
 * limité à une partie du service — a été volontairement écarté : son périmètre
 * demande une granularité que `@Roles(...)` n'exprime pas, et livrer un rôle
 * dont les gardes ne savent pas tenir la promesse reviendrait à mentir sur
 * l'écran de création.
 *
 * ─── `cogerant` ET NON `gerant` : DEUX MOTS POUR DEUX CHOSES ───
 *
 * `gerant` est déjà pris — c'est le rôle d'un PORTEUR DE CODE sur tablette
 * (`STAFF_ROLES`). Réemployer le mot pour un compte à mot de passe rendrait
 * impossible de dire, en lisant une ligne de journal ou un décorateur, laquelle
 * des deux portes s'ouvre. Le compte s'appelle donc `cogerant`, et le code sur
 * tablette garde `gerant`.
 *
 * ─── CE QUE CE MODÈLE DEVIENDRA ───
 *
 * Un chantier ultérieur remplacera ces rôles par des PERMISSIONS NOMMÉES et
 * introduira l'APPARTENANCE — une personne rattachée à plusieurs restaurants.
 * Ce jour-là :
 *
 *  · `users.tenantId` (un seul établissement par compte) cède la place à une
 *    table d'appartenances `(compte, établissement, rôle)`, et l'unicité
 *    mondiale de `email` cesse d'être une limite fonctionnelle — voir
 *    `courrielDejaPris` plus bas, qui décrit exactement ce qui change ;
 *  · `ROLES_SUBSUMES` disparaît : la subsomption n'existe que parce qu'un rôle
 *    est un mot unique. Avec des permissions, `cogerant` devient une LISTE de
 *    permissions qui contient celles de `gerant`, et il n'y a plus rien à
 *    étendre au moment de la garde ;
 *  · `COMPTES_PAR_FORMULE` compte alors des APPARTENANCES à cet établissement,
 *    pas des documents `users` — la même personne chez deux clients ne doit
 *    consommer une place que chez chacun d'eux.
 *
 * Rien de tout cela n'est construit ici : ni table d'appartenance, ni
 * permission, ni invitation par courriel. Ce commentaire existe pour que le
 * chantier suivant sache où sont les coutures, pas pour les coudre d'avance.
 */

// ─────────────────────────────────────────────────────────────
// Les rôles de compte
// ─────────────────────────────────────────────────────────────

/**
 * LES RÔLES D'UN COMPTE E-MAIL + MOT DE PASSE.
 *
 * `sm_admin` est l'équipe Snack Manager : un compte SANS établissement
 * (`tenantId: null`), qui traverse le parc. Les trois autres appartiennent à un
 * restaurant et un seul.
 *
 * À NE PAS CONFONDRE avec `STAFF_ROLES` (`gerant`, `caisse`, `cuisine`), qui
 * sont des rôles de PORTEUR DE CODE sur tablette appairée : ceux-là n'ont pas
 * de mot de passe, pas d'e-mail, et ne comptent jamais dans le quota de comptes.
 */
export const USER_ROLES = ['owner', 'cogerant', 'comptable', 'sm_admin'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Les rôles qui vivent DANS un restaurant — `sm_admin` exclu.
 *
 * C'est cette liste que le quota compte, que la fiche client affiche, et que
 * l'écran de création propose. `sm_admin` n'y figure pas : nos propres comptes
 * ne se créent pas depuis la fiche d'un client, et un jeton `sm_admin` porté
 * par un tenant serait une anomalie que `SessionAccessService` refuse déjà.
 */
export const ROLES_COMPTE = ['owner', 'cogerant', 'comptable'] as const;
export const RoleCompteSchema = z.enum(ROLES_COMPTE);
export type RoleCompte = z.infer<typeof RoleCompteSchema>;

/**
 * LES RÔLES QUE LE SUPPORT PEUT ATTRIBUER — et `owner` n'en est pas.
 *
 * Le propriétaire naît à la signature et ne s'attribue pas ensuite : c'est lui
 * qui porte l'abonnement et l'encaissement, donc la relation commerciale. En
 * créer un second dédoublerait la personne à qui l'on facture ; en promouvoir
 * un troisième laisserait deux comptes se disputer le raccordement Stripe.
 * Symétriquement, le propriétaire ne se rétrograde pas et ne se révoque pas —
 * un restaurant sans propriétaire est un restaurant qu'on ne peut plus
 * facturer, et le geste qui le produirait ne se rattrape que dans Mongo.
 */
export const ROLES_ATTRIBUABLES = ['cogerant', 'comptable'] as const;
export const RoleAttribuableSchema = z.enum(ROLES_ATTRIBUABLES);
export type RoleAttribuable = z.infer<typeof RoleAttribuableSchema>;

/** Ce que le support lit sur la fiche client — un titre, pas une clé. */
export const ROLE_COMPTE_LABELS: Record<RoleCompte, string> = {
  owner: 'Propriétaire',
  cogerant: 'Cogérant',
  comptable: 'Comptable',
};

/**
 * CE QUE CHAQUE RÔLE OUVRE, en une phrase — affichée sous le choix, au moment
 * de créer le compte.
 *
 * Elle dit d'abord ce que le rôle NE PEUT PAS, parce que c'est la question que
 * l'opérateur se pose au téléphone : « est-ce que je peux lui donner ça sans
 * qu'il touche à la facture ? ». Un intitulé seul ne répond jamais à ça.
 */
export const ROLE_COMPTE_HINTS: Record<RoleCompte, string> = {
  owner:
    'Tout, y compris l’abonnement et le raccordement d’encaissement. Créé à la signature, il ne se change ni ne se révoque.',
  cogerant:
    'Tout l’opérationnel : carte, stocks, équipe, planning, horaires, fidélité, promotions, avis, appareils, écrans, site. Ni abonnement, ni encaissement.',
  comptable:
    'Lecture seule sur l’argent : statistiques, exports, factures, registre des gestes sensibles. Aucune écriture, nulle part.',
};

// ─────────────────────────────────────────────────────────────
// La subsomption — comment 107 décorateurs apprennent un rôle
// ─────────────────────────────────────────────────────────────

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  UN RÔLE QUI PEUT TOUT CE QUE PEUT UN AUTRE SE DIT UNE FOIS.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * L'API porte 107 décorateurs `@Roles(...)` pour six combinaisons distinctes,
 * dont 67 en `('owner', 'gerant')`. Ouvrir l'opérationnel à `cogerant` en
 * modifiant 67 décorateurs, c'est 67 occasions d'en oublier un — et l'oubli ne
 * se voit pas : la route refuse simplement un rôle légitime, sur un écran que
 * personne n'ouvre tous les jours.
 *
 * `cogerant` SUBSUME donc `gerant` : la garde d'authentification étend le rôle
 * du jeton avant de le confronter au décorateur. Une seule ligne de données,
 * un seul point d'application (`AuthGuard`), et les 67 décorateurs restent
 * lisibles tels qu'ils sont — ils disent toujours « le gérant a le droit », ce
 * qui reste vrai.
 *
 * ─── CE QUE LA SUBSOMPTION N'ATTEINT PAS, ET C'EST L'ESSENTIEL ───
 *
 * Elle n'ouvre QUE ce que `gerant` ouvrait. Les surfaces réservées à `owner`
 * seul restent fermées à `cogerant`, sans exception ni cas particulier :
 *
 *  · `EncaissementController` — `@Roles('owner')` sur la classe : le
 *    raccordement Stripe, c'est-à-dire l'endroit où l'argent des clients
 *    arrive ;
 *  · `BillingIdentityController` — `@Roles('owner')` : le SIRET et la raison
 *    sociale imprimés sur les factures ;
 *  · `MyBillingController` — garde dédié (`TenantSessionGuard`) : l'abonnement
 *    et les pièces ;
 *  · `PayrollGuard` (module planning) — `canReadPayroll` : les rémunérations.
 *
 * Un test le prouve route par route plutôt que de le promettre en commentaire.
 *
 * ─── POURQUOI `comptable` N'EST PAS ICI ───
 *
 * Parce que « lecture seule » n'est pas exprimable par subsomption : aucun rôle
 * existant ne signifie « les `@Get` de ce contrôleur, et rien d'autre ». Le
 * simuler — en faisant subsumer `gerant` puis en espérant que les écritures se
 * refusent ailleurs — donnerait un rôle qui écrit. `comptable` est donc AJOUTÉ
 * EXPLICITEMENT aux quelques routes de lecture dont il a besoin, une par une,
 * et un test parcourt les contrôleurs pour prouver qu'aucune route non-`@Get`
 * ne l'accepte.
 */
export const ROLES_SUBSUMES: Readonly<Record<string, readonly string[]>> = {
  cogerant: ['gerant'],
};

/**
 * LES NOMS DE RÔLE AUXQUELS UNE SESSION RÉPOND — le sien, plus ceux qu'il
 * subsume.
 *
 * Rendue en tableau et non en `Set` : la garde la parcourt une fois par
 * requête sur au plus deux entrées, et un tableau se compare à l'œil dans un
 * test. Le rôle propre vient TOUJOURS en tête — un rôle sans subsomption
 * rend exactement `[role]`, ce qui laisse le comportement d'avant strictement
 * inchangé pour `owner`, `sm_admin` et les trois rôles de tablette.
 */
export function rolesEndosses(role: string): readonly string[] {
  const herites = ROLES_SUBSUMES[role];
  return herites ? [role, ...herites] : [role];
}

/**
 * Cette session satisfait-elle un décorateur `@Roles(...)` ?
 *
 * Écrite ici plutôt que dans la garde pour une raison précise : c'est une règle
 * d'AUTORISATION, elle doit se tester sans monter Nest, et la barre de
 * navigation du back-office se pose exactement la même question pour décider ce
 * qu'elle propose. Deux implémentations divergeraient.
 */
export function roleSatisfait(role: string, exiges: readonly string[]): boolean {
  if (exiges.length === 0) return true;
  const endosses = rolesEndosses(role);
  return exiges.some((exige) => endosses.includes(exige));
}

// ─────────────────────────────────────────────────────────────
// Combien de comptes par formule — une DÉCISION D'OFFRE
// ─────────────────────────────────────────────────────────────

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  CE TABLEAU EST UNE DÉCISION D'OFFRE, PAS UNE DÉCISION D'ARCHITECTURE.   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Exactement comme `CAPACITES_PAR_FORMULE` (capacites.ts) : y toucher ne
 * modifie aucune logique, cela change ce que des clients payants peuvent faire
 * le lendemain matin. Il se relit comme un tarif, il se déploie sans qu'une
 * ligne de code bouge, et il vit à côté de la grille pour qu'on ne puisse pas
 * changer l'un en oubliant l'autre.
 *
 * ─── CE QUE COMPTE CE NOMBRE ───
 *
 * Des COMPTES À MOT DE PASSE, propriétaire COMPRIS. Un restaurant en Essentiel
 * a donc son propriétaire et personne d'autre ; en Complet, le propriétaire et
 * un second compte ; en Boost, le propriétaire et trois autres.
 *
 * Les porteurs de code à quatre chiffres (`STAFF_ROLES`) n'y entrent JAMAIS, et
 * ce n'est pas un détail de comptage : ils n'ouvrent que la tablette du
 * comptoir, ils sont déjà limités par le nombre d'appareils appairés, et les
 * faire tomber sous ce quota reviendrait à facturer l'embauche d'un équipier.
 *
 * ─── ET SANS FORMULE ? UN ─────────────────────────────────────────────────
 *
 * `plan: null` est le client de l'Atelier : il n'a acheté QUE des services
 * (site, réseaux, présence) ou QUE le module de commande en ligne greffé sur
 * son propre site. Il n'a aucun back-office à organiser — il a en revanche
 * besoin d'un compte pour lire ses factures et régulariser, et ce compte-là
 * existe déjà, c'est le propriétaire né de sa signature.
 *
 * UN, donc, et pas zéro : zéro rendrait le parc incohérent le jour de la
 * signature, puisque la conversion vient précisément de créer ce compte. Et
 * pas deux : distribuer gratuitement à qui n'a pas de logiciel ce qu'Essentiel
 * ne donne pas serait un tarif à l'envers.
 */
export const COMPTES_PAR_FORMULE = {
  essentiel: 1,
  complet: 2,
  boost: 4,
} as const satisfies Record<Formule, number>;

/** Sans formule — voir le commentaire ci-dessus : le propriétaire, et lui seul. */
export const COMPTES_SANS_FORMULE = 1;

/** Le plafond d'un établissement, formule ou non. */
export function comptesAutorises(plan: Formule | null | undefined): number {
  return plan ? COMPTES_PAR_FORMULE[plan] : COMPTES_SANS_FORMULE;
}

/**
 * LE REFUS, CHIFFRÉ — sur le modèle du refus des places fondateur.
 *
 * « Limite atteinte » n'apprend rien à qui est au téléphone avec le
 * restaurateur. Le nombre ouvert, le nombre pris et la sortie possible tiennent
 * en une phrase, et c'est cette phrase que le CRM affiche telle quelle.
 *
 * La formule n'est pas NOMMÉE ici : le message part vers un écran de l'équipe,
 * mais la règle d'or du produit vaut aussi pour les phrases — nommer « Boost »
 * ferait de ce fichier un second endroit où lire le conditionnement. Le
 * plafond parle mieux que le nom de l'offre, de toute façon.
 */
export function refusQuotaComptes(max: number): string {
  return (
    `Cette offre ouvre ${max} compte${max > 1 ? 's' : ''} et ${max > 1 ? 'les ' : 'le '}` +
    `${max} ${max > 1 ? 'sont pris' : 'est pris'} — révoquez un compte ou faites passer ` +
    `ce client à l’offre supérieure.`
  );
}

/**
 * L'ADRESSE EST UNIQUE DANS TOUT LE PARC, et le refus est le bon comportement.
 *
 * `users.email` porte un index unique MONDIAL, et `AuthService.login` cherche
 * un compte par son seul e-mail : l'adresse EST l'identifiant de connexion. Une
 * même adresse chez deux restaurants n'aurait donc aucun sens exploitable — la
 * connexion rendrait l'un des deux documents, arbitrairement, et la personne
 * atterrirait un jour sur deux dans le mauvais back-office.
 *
 * Les deux « solutions » évidentes sont pires que le refus :
 *  · déplacer le compte existant vers le nouveau restaurant fermerait, sans
 *    prévenir, l'accès de celui qui l'utilise aujourd'hui ;
 *  · créer un second document contournerait l'index unique et laisserait deux
 *    empreintes de mot de passe pour une seule personne, dont une seule
 *    servirait — l'autre étant un accès fantôme que personne ne penserait à
 *    révoquer.
 *
 * Le refus NOMME l'établissement propriétaire de l'adresse. Ce n'est pas une
 * fuite : ce message ne part que vers le CRM, dont l'opérateur voit déjà tout
 * le parc, et c'est l'information dont il a besoin pour trancher au téléphone
 * (« c'est son adresse perso, il l'utilise déjà chez son autre restaurant »).
 *
 * C'EST LA LIMITE QUE L'APPARTENANCE LÈVERA. Le jour où une personne pourra
 * appartenir à plusieurs restaurants, ce refus deviendra un RATTACHEMENT : le
 * compte existe déjà, on lui ajoute une appartenance au second établissement
 * avec son propre rôle. Le message ci-dessous est écrit pour ce jour-là — il
 * dit ce qui bloque, pas « c'est impossible ».
 */
export function courrielDejaPris(email: string, etablissement: string): string {
  return (
    `L’adresse « ${email} » ouvre déjà un compte chez ${etablissement}. ` +
    `Une adresse ne peut appartenir qu’à un établissement : choisissez-en une autre, ` +
    `ou révoquez d’abord le compte existant.`
  );
}

// ─────────────────────────────────────────────────────────────
// Ce que le support envoie
// ─────────────────────────────────────────────────────────────

/**
 * CRÉER UN COMPTE — et ce que ce corps ne porte PAS.
 *
 * Ni mot de passe ni empreinte : le secret est FABRIQUÉ par le serveur et remis
 * une seule fois dans la réponse, exactement comme à la signature
 * (`ConversionService.convert`). Un mot de passe choisi par l'opérateur serait
 * un mot de passe qui transite par un canal de moins bonne qualité que celui
 * qu'on fabrique, et qui ressemblerait à celui du client précédent.
 *
 * Ni motif : créer un compte n'est pas un geste contre le restaurateur, c'est
 * un geste POUR lui, demandé par lui. Le journal porte l'adresse, le rôle et
 * l'auteur — ce qui répond déjà à « qui a ouvert cet accès, quand, pour qui ».
 * Le motif est exigé là où le geste se subit : changement de rôle, révocation.
 *
 * `role` est `ROLES_ATTRIBUABLES` et non `ROLES_COMPTE` : on ne crée pas un
 * second propriétaire (voir `ROLES_ATTRIBUABLES`).
 */
export const CompteCreateSchema = z
  .object({
    /**
     * NORMALISÉE AVANT D'ÊTRE VALIDÉE, et l'ordre n'est pas un détail : la
     * connexion cherche un compte par son e-mail EN MINUSCULES
     * (`AuthService.login`), et l'index unique de la collection est
     * `lowercase`. Une adresse tapée « Sarah@ClassFood.FR » par un opérateur
     * qui la recopie d'un mail doit donc arriver normalisée en base, sinon le
     * contrôle d'unicité passe à côté d'un doublon qu'il aurait dû voir.
     *
     * `.trim().toLowerCase()` AVANT `.pipe(z.email(...))` : dans l'autre sens,
     * zod valide la chaîne brute et refuse une adresse parfaitement bonne pour
     * un espace collé au copier-coller.
     */
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email('Adresse e-mail invalide').max(160)),
    /**
     * Le NOM AFFICHÉ — obligatoire, contrairement au champ en base qui tolère
     * le vide pour les comptes historiques. Le registre des gestes sensibles
     * dénormalise ce nom à chaque ligne : un compte créé sans nom écrirait
     * « » dans un registre à valeur probante, et c'est irrattrapable a
     * posteriori — la ligne ne se réécrit pas.
     */
    nom: z.string().trim().min(2, 'Nom de la personne obligatoire').max(120),
    role: RoleAttribuableSchema,
  })
  .strict();
export type CompteCreate = z.infer<typeof CompteCreateSchema>;

/**
 * CHANGER LE RÔLE D'UN COMPTE — motif obligatoire.
 *
 * Même exigence que la suspension (`TenantSuspendSchema`) et la dérogation de
 * capacité (`TenantCapaciteSchema`), pour la même raison : ce geste RETIRE ou
 * ACCORDE des droits sur l'outil de travail de quelqu'un, et « pourquoi ce
 * comptable est-il devenu cogérant le 12 mars ? » se pose au litige. Il coupe
 * en outre les sessions ouvertes de la personne visée : elle le vivra comme une
 * déconnexion inexpliquée si le journal ne dit rien.
 */
export const CompteRoleSchema = z
  .object({
    role: RoleAttribuableSchema,
    motif: z.string().trim().min(3, 'Motif obligatoire').max(200),
  })
  .strict();
export type CompteRole = z.infer<typeof CompteRoleSchema>;

/** RÉVOQUER un compte — motif obligatoire, même règle que le changement de rôle. */
export const CompteRevokeSchema = z
  .object({
    motif: z.string().trim().min(3, 'Motif obligatoire').max(200),
  })
  .strict();
export type CompteRevoke = z.infer<typeof CompteRevokeSchema>;

// ─────────────────────────────────────────────────────────────
// Ce que l'API rend — PROJETÉ, en liste blanche
// ─────────────────────────────────────────────────────────────

/**
 * UN COMPTE, TEL QU'IL SORT DE L'API.
 *
 * Liste blanche STRICTE, et le champ absent est celui qui compte :
 * `passwordHash` n'a aucun chemin vers une réponse. Un document `users` rendu
 * tel quel — par un `.lean()` sans projection, par un `toJSON()` distrait —
 * publierait l'empreinte Argon2 du mot de passe d'un restaurateur dans le CRM,
 * c'est-à-dire dans un onglet de navigateur, dans un journal de proxy et dans
 * l'historique réseau de qui regarde. Un test le prouve avec un double qui rend
 * le document ENTIER : c'est la projection qui garde, pas la discipline.
 */
export type CompteRestaurant = {
  id: string;
  email: string;
  nom: string;
  role: RoleCompte;
  roleLabel: string;
  /** Le compte né à la signature — ni révocable, ni changeable de rôle. */
  proprietaire: boolean;
  /** ISO, ou `null` pour un document antérieur aux horodatages. */
  creeLe: string | null;
};

/** La liste, avec de quoi peindre le quota sans le recalculer côté écran. */
export type ComptesRestaurant = {
  comptes: readonly CompteRestaurant[];
  /** Le plafond de la formule — propriétaire compris. */
  max: number;
  /** Ce qu'il reste à ouvrir. Jamais négatif : un parc historique peut déborder. */
  restants: number;
};

/**
 * UN COMPTE QUI VIENT DE NAÎTRE — le mot de passe, une seule fois.
 *
 * Même contrat que `LeadConversion.password` à la signature : la valeur en
 * clair ne repasse jamais, nulle part. Elle n'est ni stockée, ni renvoyée par
 * la liste, ni relisible dans le journal — qui porte l'adresse et le rôle, et
 * s'arrête là.
 */
export type CompteCree = CompteRestaurant & { password: string };

/**
 * LA PROJECTION — le seul chemin entre un document `users` et une réponse.
 *
 * Elle accepte `unknown` à dessein : les appelants lui passent un document
 * Mongo `lean()`, dont le type porte `passwordHash`. Une signature typée sur
 * une forme sûre inviterait à faire `{ ...doc }` ailleurs « puisque le type est
 * propre » ; ici, rien ne sort que ce qui est nommé ligne à ligne.
 */
export function projeterCompte(document: unknown): CompteRestaurant {
  const doc = (document ?? {}) as Record<string, unknown>;
  const role = (ROLES_COMPTE as readonly string[]).includes(String(doc.role))
    ? (String(doc.role) as RoleCompte)
    : 'cogerant';
  const creeLe = doc.createdAt;
  return {
    id: String(doc._id ?? ''),
    email: String(doc.email ?? ''),
    nom: String(doc.name ?? ''),
    role,
    roleLabel: ROLE_COMPTE_LABELS[role],
    proprietaire: role === 'owner',
    creeLe:
      creeLe instanceof Date
        ? creeLe.toISOString()
        : typeof creeLe === 'string' && !Number.isNaN(new Date(creeLe).getTime())
          ? new Date(creeLe).toISOString()
          : null,
  };
}
