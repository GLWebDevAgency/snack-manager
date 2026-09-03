import { z } from 'zod';

/**
 * LES CAPACITÉS — CE QUE LE RESTAURANT A PAYÉ.
 *
 * Deux axes indépendants gouvernent l'accès à une fonction, et les confondre
 * est la faute que ce module existe pour rendre impossible :
 *
 *  · la PERMISSION répond à « cette personne a-t-elle le droit ? ». Elle
 *    dépend du rôle, elle vit dans `@Roles(...)` côté API et dans `roles` de
 *    la table de navigation. Son refus est un refus : l'équipier de cuisine
 *    n'ouvrira jamais l'écran d'abonnement, et il n'a rien à y gagner ;
 *  · la CAPACITÉ répond à « ce restaurant a-t-il souscrit cette fonction ? ».
 *    Elle dépend de la formule et des options, elle vit ici. Son refus est une
 *    PROPOSITION COMMERCIALE : la fonction existe, elle n'est pas achetée.
 *
 * Le contrôle est un ET, et les deux sources restent séparées. Un gérant qui
 * n'a pas souscrit la commande en ligne n'a pas un problème de droits ; un
 * équipier de cuisine n'a pas un problème d'abonnement. Les mêler donnerait à
 * l'un le message de l'autre.
 *
 * ─── LA RÈGLE D'OR : LE CODE NE CONNAÎT JAMAIS LE NOM D'UNE FORMULE ───
 *
 * Nulle part ailleurs que dans le CATALOGUE ci-dessous le produit ne demande
 * « la formule vaut-elle Boost ? ». Il demande « ce restaurant a-t-il la
 * capacité `online` ? ». La différence se paie le jour — certain — où le
 * conditionnement bouge : une promotion, un renommage, un geste commercial, un
 * ancien client gardé aux anciennes conditions. Avec un nom de formule
 * disséminé dans trente fichiers, c'est un chantier ; avec ce catalogue, c'est
 * une ligne de données.
 *
 * Un test de dérive verrouille la règle des deux côtés (API et back-office
 * restaurateur) : `formules-invisibles.test.ts`.
 *
 * ─── D'OÙ VIENT CETTE LISTE : DE LA PROMESSE PUBLIÉE ───
 *
 * Elle n'est pas déduite des modules techniques, et surtout pas inventée : ce
 * sont les ONZE modules affichés aux prospects sur `/offres` et dans la grille
 * tarifaire de la page d'accueil, avec la mention « Inclus » ou « Non inclus »
 * ligne par ligne (`PLAN_MODULES`, `apps/web/src/components/marketing/content.ts`).
 *
 * Cette matrice était jusqu'ici la SEULE vérité du conditionnement, et elle
 * vivait dans une page. Résultat mesurable : rien de ce qui y est écrit
 * n'était appliqué — un restaurant à 99 € disposait du planning, des stocks,
 * de la commande en ligne et de la fidélité, tous vendus « non inclus ». Une
 * promesse commerciale qui vit dans un composant React finit toujours par
 * diverger de ce que le logiciel fait.
 *
 * Le catalogue vit donc ICI, dans le contrat, et la vitrine le RELIT. Elle ne
 * peut pas l'importer (`content.ts` est lu par des composants clients et
 * `@sm/contracts` embarque zod : l'import ferait descendre un validateur de
 * schémas entier dans le JavaScript de la page d'accueil). Elle en garde donc
 * une copie, accordée par une assertion de TYPE qui casse le typecheck le jour
 * où les deux listes divergent — exactement le montage déjà en place pour la
 * grille de prix (`GRILLES_ACCORDÉES`).
 *
 * Les CLÉS sont celles de la matrice (`pos`, `kds`, `bo`…) et pas des noms
 * français inventés ici : deux jeux de noms pour une seule liste, ce serait
 * une table de correspondance de plus, donc un second endroit où diverger. Ce
 * que le restaurateur LIT, lui, ne vient jamais de la clé — c'est
 * `CAPACITE_LABELS`, mot pour mot le libellé publié.
 *
 * ─── CE QUI N'EST PAS UNE CAPACITÉ ───
 *
 * Le SOCLE : l'établissement, les horaires, l'appairage des appareils, l'écran
 * d'abonnement, l'équipe et ses codes. Aucun de ces écrans n'a de ligne dans
 * la matrice publiée — donc rien ne leur a jamais été promis, donc rien ne
 * doit leur être retiré. Fermer une surface sur laquelle on n'a rien vendu,
 * c'est inventer une offre ; et deux d'entre elles sont vitales — un écran
 * d'abonnement fermé, c'est le client empêché de régler ce qu'on lui reproche.
 */

// ─────────────────────────────────────────────────────────────
// La liste fermée — les onze modules de la grille publiée
// ─────────────────────────────────────────────────────────────

/**
 * LES ONZE CAPACITÉS DU PRODUIT, dans l'ordre de la grille tarifaire.
 *
 * L'ordre fait loi trois fois : c'est celui que lit le prospect sur `/offres`,
 * celui dans lequel les capacités effectives sont rendues au front, et celui
 * que l'assertion de type compare à la copie de la vitrine. Le changer se voit
 * donc partout, ce qui est exactement ce qu'on veut d'un ordre qui porte du
 * sens.
 */
export const CAPACITES = [
  'pos',
  'kds',
  'print',
  'offline',
  'bo',
  'menu',
  'planning',
  'stocks',
  'online',
  'loyalty',
  'priority',
] as const;

export const CapaciteSchema = z.enum(CAPACITES);
export type Capacite = z.infer<typeof CapaciteSchema>;

/**
 * CE QUE LE RESTAURATEUR LIT — mot pour mot le libellé publié.
 *
 * Ces phrases sortent sur l'écran d'un commerçant : dans le verrou d'une
 * entrée de navigation, dans le refus d'une route, dans la fiche client du
 * CRM. Elles doivent être LES MÊMES que celles qu'il a lues avant de signer —
 * un module vendu « Ingrédients, stocks & coût matière » et refusé sous le nom
 * « Stocks » le laisse se demander s'il s'agit de la même chose.
 */
export const CAPACITE_LABELS: Record<Capacite, string> = {
  pos: 'Caisse (POS)',
  kds: 'Cuisine (KDS)',
  print: 'Ticket cuisine & sticker sac',
  offline: 'Mode hors-ligne',
  bo: 'Back-office : CA, commandes, exports CSV',
  menu: 'Menu & prix en direct',
  planning: 'Planning, pointage & coût de la semaine',
  stocks: 'Ingrédients, stocks & coût matière',
  online: 'Commande en ligne & click and collect',
  loyalty: 'Fidélité, codes promo & comptes clients',
  priority: 'Support prioritaire',
};

/**
 * LES LIGNES DE LA MATRICE QUI NE GARDENT AUCUNE ROUTE — et qui restent
 * pourtant au catalogue.
 *
 * « Support prioritaire » n'est pas une fonction logicielle : c'est un niveau
 * de service HUMAIN — un délai de réponse, une personne au bout du fil. Aucun
 * décorateur ne peut le vérifier, et un `@Capacites('priority')` posé sur une
 * route serait un contresens : il refuserait un écran à qui a seulement acheté
 * de la patience de notre part.
 *
 * Il reste dans la liste parce que la matrice doit être COMPLÈTE : c'est elle
 * que la vitrine affiche, et une capacité manquante ici ferait disparaître une
 * ligne de la grille tarifaire. Le catalogue décrit l'offre entière ; les
 * gardes n'en utilisent qu'une partie, et c'est normal.
 *
 * Un test vérifie qu'aucune entrée de navigation ne s'y adosse.
 */
export const CAPACITES_SANS_GARDE: readonly Capacite[] = ['priority'];

// ─────────────────────────────────────────────────────────────
// Le catalogue — LE SEUL ENDROIT DU PRODUIT QUI NOMME UNE FORMULE
// ─────────────────────────────────────────────────────────────

/**
 * Les trois formules, redéclarées ici plutôt qu'importées de `./index`.
 *
 * `index.ts` fait `export * from './capacites'` : importer `PLANS` depuis
 * l'index créerait un cycle de modules. `admin.ts` (`ADMIN_PLANS`) et `crm.ts`
 * ont fait le même choix pour la même raison, et un test de cohérence vérifie
 * que les trois listes ne divergent pas.
 */
export const FORMULES = ['essentiel', 'complet', 'boost'] as const;
export type Formule = (typeof FORMULES)[number];

/** Essentiel — « la caisse, la cuisine et le back-office ». */
const ESSENTIEL = ['pos', 'kds', 'print', 'offline', 'bo', 'menu'] as const;

/** Complet — tout l'Essentiel, plus le planning et le coût matière. */
const COMPLET = [...ESSENTIEL, 'planning', 'stocks'] as const;

/** Boost — tout, commande en ligne et fidélité comprises. */
const BOOST = [...COMPLET, 'online', 'loyalty', 'priority'] as const;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  LE CONDITIONNEMENT SE LIT ICI, ET NULLE PART AILLEURS.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Ce tableau est le point exact où « qu'est-ce qu'on met dans Essentiel ? »
 * s'écrit. Y toucher n'est pas une modification de code : c'est une DÉCISION
 * D'OFFRE, qui change ce que des clients payants ont sous les doigts le
 * lendemain matin, et qui doit d'abord changer sur la page publique — parce
 * que c'est là qu'elle a été promise. Elle se relit comme un tarif, et elle se
 * déploie sans qu'une seule ligne de logique bouge.
 *
 * Les trois lignes sont CUMULATIVES par construction (`COMPLET` part
 * d'`ESSENTIEL`, `BOOST` part de `COMPLET`) et pas recopiées, parce que c'est
 * exactement ce que la grille promet : « Tout l'Essentiel, plus… ». Le jour où
 * une formule cesserait d'inclure la précédente, il faudra l'écrire à plat —
 * et ce sera visible.
 *
 * ─── CE QUE CE TABLEAU CHANGE LE JOUR OÙ IL EST APPLIQUÉ ───
 *
 * Rien n'était appliqué : la matrice ne vivait que dans la page. Un client
 * Essentiel disposait du planning, des stocks, de la fidélité et de la
 * commande en ligne, tous affichés « non inclus » sur la page qui lui a été
 * montrée. Ce tableau ferme cet écart — c'est son objet.
 */
export const CAPACITES_PAR_FORMULE = {
  essentiel: ESSENTIEL,
  complet: COMPLET,
  boost: BOOST,
} as const satisfies Record<Formule, readonly Capacite[]>;

/**
 * SANS FORMULE — `plan: null`, et ce n'est pas une anomalie.
 *
 * Depuis l'Atelier, un restaurateur peut n'acheter QUE des services (site,
 * réseaux, présence) ou QUE le module de commande en ligne greffé sur son
 * propre site. Il a alors un établissement chez nous sans abonnement
 * logiciel — et donc, littéralement, aucune capacité de formule : la grille ne
 * lui a rien promis, il n'a pas de colonne.
 *
 * La liste est VIDE et non « le socle par prudence » : accorder en silence ce
 * qui n'a pas été vendu vaut exactement autant qu'un refus injustifié, et se
 * découvre bien plus tard. Ce qu'il a acheté à part — le module de commande en
 * ligne — lui revient par l'option ci-dessous, pas par cette ligne.
 */
export const CAPACITES_SANS_FORMULE: readonly Capacite[] = [];

/**
 * LES OPTIONS — ce qui s'achète EN PLUS de la formule.
 *
 * Clé : le champ booléen du tenant qui porte la souscription. Valeur : la
 * capacité qu'il ouvre. Une seule option existe aujourd'hui, et le tableau
 * existe quand même : la prochaine s'ajoutera par une ligne, pas par un `if`
 * de plus dans le calcul.
 *
 * La commande en ligne se résout donc par FORMULE **ou** par OPTION : comprise
 * dans Boost, vendue 79 €/mois aux deux autres. C'est déjà la règle de la
 * facturation — `moduleFacture = onlineOrdering && plan !== 'boost'` (crm.ts) —
 * et `capacitesEffectives` doit rendre exactement le même résultat sur les six
 * combinaisons ; un test les épingle une par une.
 *
 * `onlineOrdering` est une SOUSCRIPTION, à ne jamais confondre avec
 * `settings.onlineOrderingPaused`, qui est la pause d'un soir de coup de feu.
 */
export const CAPACITES_PAR_OPTION = {
  onlineOrdering: 'online',
} as const satisfies Record<string, Capacite>;

// ─────────────────────────────────────────────────────────────
// Les dérogations — l'exception commerciale, tracée
// ─────────────────────────────────────────────────────────────

/**
 * Accorder ou retirer, et rien d'autre.
 *
 * `accordee` : la fonction est ouverte HORS formule — un geste commercial, une
 * période d'essai sur une option, un ancien client gardé aux anciennes
 * conditions. `retiree` : la fonction est fermée MALGRÉ la formule — un module
 * en panne chez un client, une fonction retirée le temps d'un litige.
 */
export const SENS_DEROGATION = ['accordee', 'retiree'] as const;
export const SensDerogationSchema = z.enum(SENS_DEROGATION);
export type SensDerogation = z.infer<typeof SensDerogationSchema>;

/**
 * UNE DÉROGATION — et le motif n'est pas décoratif.
 *
 * Une capacité ouverte hors formule est un manque à gagner, une capacité
 * fermée malgré la formule est un litige : dans les deux cas quelqu'un
 * demandera « pourquoi ? » six mois plus tard, et « je crois que c'était pour
 * la reprise de son ancien logiciel » n'est pas une réponse. Le motif et
 * l'auteur sont donc OBLIGATOIRES, comme sur l'annulation d'une commande
 * (`OrderCancelSchema`) et pour la même raison.
 *
 * C'est aussi ce qui permet d'appliquer la grille sans casser personne : un
 * client dont la formule ne couvre plus ce qu'il utilisait depuis un an garde
 * sa fonction par une ligne datée et motivée, au lieu qu'on lui invente une
 * formule qui fausserait aussitôt sa facture et le MRR du CRM.
 *
 * `le` circule en ISO dans les réponses d'API et se stocke en `Date` en base —
 * même convention que `TenantAccount.since`.
 */
export const DerogationCapaciteSchema = z
  .object({
    capacite: CapaciteSchema,
    sens: SensDerogationSchema,
    motif: z.string().trim().min(3, 'Motif obligatoire').max(200),
    /** Qui l'a accordée — un membre de l'équipe Snack Manager, nommé. */
    auteur: z.string().trim().min(1).max(120),
    le: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  })
  .strict();
export type DerogationCapacite = z.infer<typeof DerogationCapaciteSchema>;

/**
 * LES TROIS GESTES DE L'ÉQUIPE — accorder, retirer, et REVENIR EN ARRIÈRE.
 *
 * Les deux premiers sont les `SENS_DEROGATION` ci-dessus. Le troisième n'en est
 * pas un : « lever » n'ouvre ni ne ferme rien, il EFFACE la ligne et rend la
 * capacité à ce que la formule en dit. Sans lui, une dérogation posée par
 * erreur — la mauvaise capacité, le mauvais client — ne pourrait se corriger
 * qu'en posant la dérogation inverse, c'est-à-dire en empilant deux exceptions
 * pour revenir à la règle. Le journal deviendrait illisible au moment précis où
 * on lui demande de dire ce qui s'est passé.
 *
 * C'est aussi la seule façon de RENDRE une capacité retirée : un retrait
 * l'emporte toujours sur un octroi, par construction (`capacitesEffectives`) —
 * on ne le neutralise donc pas en accordant par-dessus, on le lève.
 */
export const GESTES_DEROGATION = [...SENS_DEROGATION, 'levee'] as const;
export const GesteDerogationSchema = z.enum(GESTES_DEROGATION);
export type GesteDerogation = z.infer<typeof GesteDerogationSchema>;

/** Ce que l'équipe lit sur le bouton — un verbe, parce que c'est un geste. */
export const GESTE_DEROGATION_LABELS: Record<GesteDerogation, string> = {
  accordee: 'Accorder hors formule',
  retiree: 'Retirer malgré la formule',
  levee: 'Lever la dérogation',
};

/**
 * LE CORPS DE LA ROUTE — et ce qu'il ne porte PAS.
 *
 * Ni `auteur` ni `le` : le premier vient du jeton de l'appelant, le second de
 * l'horloge du serveur. Les accepter du client laisserait l'équipe — ou
 * n'importe qui ayant un jeton `sm_admin` — signer une exception commerciale du
 * nom d'un collègue, et l'antidater. Le motif d'une dérogation existe pour être
 * relu au litige : sa signature ne peut pas venir de la même main que le geste.
 *
 * Le MOTIF est obligatoire pour les trois gestes, levée comprise, exactement
 * comme sur la suspension (`TenantSuspendSchema`) et l'annulation d'une commande
 * (`OrderCancelSchema`). « Pourquoi cette fonction a-t-elle rouvert le 12 mars »
 * est la même question que « pourquoi a-t-elle fermé », et elle se pose aussi
 * souvent.
 */
export const TenantCapaciteSchema = z
  .object({
    capacite: CapaciteSchema,
    geste: GesteDerogationSchema,
    motif: z.string().trim().min(3, 'Motif obligatoire').max(200),
  })
  .strict();
export type TenantCapacite = z.infer<typeof TenantCapaciteSchema>;

// ─────────────────────────────────────────────────────────────
// Le calcul — pur, tolérant, et seule autorité
// ─────────────────────────────────────────────────────────────

/**
 * CE QUE LE CALCUL LIT DU RESTAURANT — trois champs, et rien de plus.
 *
 * Les valeurs sont `unknown` volontairement : cette fonction est nourrie par
 * un document Mongo `.lean()`, qui ne matérialise pas les défauts et porte le
 * parc historique. Un champ absent, `null`, ou d'un type inattendu doit
 * produire un résultat, jamais une exception — c'est le calcul qui décide si
 * la vitrine d'un restaurant prend des commandes ce soir.
 */
export type SouscriptionLue = {
  /** La formule, ou `null`/absente pour un client sans abonnement logiciel. */
  plan?: unknown;
  /** Le module de commande en ligne — la souscription, pas la pause du soir. */
  onlineOrdering?: unknown;
  /** Les exceptions accordées ou retirées par l'équipe Snack Manager. */
  derogationsCapacite?: readonly unknown[] | null;
};

/**
 * LES DÉROGATIONS LISIBLES D'UN DOCUMENT, dans l'ordre où elles sont stockées.
 *
 * Seuls `capacite` et `sens` conditionnent la lecture : sans eux la ligne ne
 * veut rien dire et elle est ignorée. Le motif, l'auteur et la date sont rendus
 * TELS QU'ILS SONT — même vides — parce que ce lecteur sert aussi à réécrire le
 * tableau (`appliquerDerogation`) : y inventer une valeur de défaut ferait
 * signer une exception commerciale par personne.
 *
 * `le` ressort en ISO, la convention des réponses d'API ; la base, elle, stocke
 * un `Date` que Mongoose recastera à l'écriture.
 */
export function lireDerogations(brut: readonly unknown[] | null | undefined): DerogationCapacite[] {
  const out: DerogationCapacite[] = [];
  for (const item of brut ?? []) {
    if (typeof item !== 'object' || item === null) continue;
    const ligne = item as { capacite?: unknown; sens?: unknown; motif?: unknown; auteur?: unknown; le?: unknown };
    const capacite = CAPACITES.find((c) => c === ligne.capacite);
    const sens = SENS_DEROGATION.find((s) => s === ligne.sens);
    if (!capacite || !sens) continue;
    const le =
      ligne.le instanceof Date
        ? ligne.le.toISOString()
        : typeof ligne.le === 'string'
          ? ligne.le
          : '';
    out.push({
      capacite,
      sens,
      motif: typeof ligne.motif === 'string' ? ligne.motif : '',
      auteur: typeof ligne.auteur === 'string' ? ligne.auteur : '',
      le,
    });
  }
  return out;
}

/**
 * LES CAPACITÉS EFFECTIVES D'UN RESTAURANT — l'unique autorité.
 *
 * Celles de sa formule, PLUS les options souscrites, PLUS les dérogations
 * accordées, MOINS les dérogations retirées.
 *
 * ─── UN RETRAIT L'EMPORTE TOUJOURS SUR UN OCTROI ───
 *
 * Et l'ordre des lignes n'y change rien, délibérément. Une capacité retirée
 * l'est pour une raison qui pèse (un litige, une fonction cassée chez ce
 * client, un abus) ; un octroi ancien laissé dans la liste ne doit pas la
 * ressusciter parce qu'il a été ajouté après. Le jour où l'on veut rendre la
 * capacité, on retire la ligne de retrait — un geste explicite, pas un effet
 * de tri.
 *
 * Le résultat suit l'ordre de `CAPACITES` : deux restaurants aux mêmes
 * capacités rendent la même liste, ce qui rend la réponse d'API comparable et
 * les tests lisibles.
 */
export function capacitesEffectives(souscription: SouscriptionLue): readonly Capacite[] {
  const acquises = new Set<Capacite>();

  const formule = FORMULES.find((f) => f === souscription.plan) ?? null;
  for (const c of formule ? CAPACITES_PAR_FORMULE[formule] : CAPACITES_SANS_FORMULE) {
    acquises.add(c);
  }

  const champs = souscription as Record<string, unknown>;
  for (const [champ, capacite] of Object.entries(CAPACITES_PAR_OPTION)) {
    if (champs[champ] === true) acquises.add(capacite);
  }

  const retirees = new Set<Capacite>();
  for (const lue of lireDerogations(souscription.derogationsCapacite)) {
    if (lue.sens === 'accordee') acquises.add(lue.capacite);
    else retirees.add(lue.capacite);
  }

  return CAPACITES.filter((c) => acquises.has(c) && !retirees.has(c));
}

/** Ce restaurant a-t-il souscrit cette fonction ? La seule question posée. */
export function aLaCapacite(souscription: SouscriptionLue, capacite: Capacite): boolean {
  return capacitesEffectives(souscription).includes(capacite);
}

/** La même question, quand les capacités ont déjà été calculées une fois. */
export const souscrit = (
  capacites: readonly Capacite[] | null | undefined,
  capacite: Capacite,
): boolean => (capacites ?? []).includes(capacite);

// ─────────────────────────────────────────────────────────────
// D'où vient chaque capacité — ce que l'équipe doit voir avant d'agir
// ─────────────────────────────────────────────────────────────

/**
 * TROIS SOURCES POSSIBLES, et les distinguer change le geste.
 *
 * `formule` : c'est vendu dans son abonnement — la retirer est un litige ou une
 * panne, pas un ajustement. `option` : il la paie à part (79 €/mois pour la
 * commande en ligne) — la retirer, c'est cesser de facturer. `derogation` :
 * c'est une exception que NOUS avons posée, avec un motif et un auteur — c'est
 * la seule des trois qui se lève.
 *
 * Sans cette distinction, un panneau qui affiche onze pastilles vertes ne dit
 * pas à l'opérateur ce qu'il s'apprête à faire : retirer une capacité de
 * formule et lever une dérogation se ressemblent à l'écran et n'ont rien à voir
 * au contrat.
 */
export const ORIGINES_CAPACITE = ['formule', 'option', 'derogation'] as const;
export type OrigineCapacite = (typeof ORIGINES_CAPACITE)[number];

export const ORIGINE_CAPACITE_LABELS: Record<OrigineCapacite, string> = {
  formule: 'Comprise dans la formule',
  option: 'Option souscrite',
  derogation: 'Dérogation',
};

/** Une capacité, son état, et POURQUOI elle est dans cet état. */
export type CapaciteEffective = {
  capacite: Capacite;
  /** Le libellé publié, mot pour mot — jamais la clé. */
  label: string;
  /** Le restaurant l'a-t-il, à cet instant ? */
  acquise: boolean;
  /** D'où elle vient, ou d'où vient son refus. `null` : rien ne la donne. */
  origine: OrigineCapacite | null;
  /**
   * La ligne de dérogation qui la concerne, s'il y en a une — même quand elle
   * ne change RIEN (une capacité déjà comprise dans la formule et accordée en
   * plus par un geste ancien). C'est elle qu'on lève, et on ne peut pas lever
   * ce que l'écran ne montre pas.
   */
  derogation: DerogationCapacite | null;
};

/**
 * LES ONZE CAPACITÉS D'UN RESTAURANT, chacune avec sa provenance.
 *
 * Rend TOUTE la matrice, y compris ce qu'il n'a pas : c'est un écran de vente
 * autant qu'un écran d'administration, et « non souscrit » est une information
 * — la même que celle que le restaurateur voit verrouillée dans sa navigation.
 *
 * Le résultat suit l'ordre de `CAPACITES`, comme `capacitesEffectives`, et son
 * champ `acquise` en est le MIROIR EXACT : cette fonction n'est pas une seconde
 * autorité, c'est la même réponse enrichie de sa cause. Un test l'épingle sur le
 * parc de cas.
 */
export function detailCapacites(souscription: SouscriptionLue): readonly CapaciteEffective[] {
  const acquises = capacitesEffectives(souscription);
  const derogations = lireDerogations(souscription.derogationsCapacite);
  // La DERNIÈRE ligne posée sur une capacité fait foi pour l'affichage : la
  // route n'en laisse jamais deux, mais un document repris à la main pourrait.
  const parCapacite = new Map<Capacite, DerogationCapacite>();
  for (const d of derogations) parCapacite.set(d.capacite, d);

  const formule = FORMULES.find((f) => f === souscription.plan) ?? null;
  const deLaFormule = new Set<Capacite>(
    formule ? CAPACITES_PAR_FORMULE[formule] : CAPACITES_SANS_FORMULE,
  );
  const champs = souscription as Record<string, unknown>;
  const desOptions = new Set<Capacite>();
  for (const [champ, capacite] of Object.entries(CAPACITES_PAR_OPTION)) {
    if (champs[champ] === true) desOptions.add(capacite);
  }

  return CAPACITES.map((capacite) => {
    const derogation = parCapacite.get(capacite) ?? null;
    const acquise = acquises.includes(capacite);
    const origine: OrigineCapacite | null = !acquise
      ? // Une capacité fermée n'a d'origine que si c'est NOUS qui l'avons
        // fermée : sinon elle n'a simplement pas été vendue, et « rien » est la
        // réponse juste — pas une source qu'on inventerait pour remplir la case.
        derogation?.sens === 'retiree'
        ? 'derogation'
        : null
      : deLaFormule.has(capacite)
        ? 'formule'
        : desOptions.has(capacite)
          ? 'option'
          : 'derogation';
    return { capacite, label: CAPACITE_LABELS[capacite], acquise, origine, derogation };
  });
}

/**
 * LE TABLEAU DE DÉROGATIONS APRÈS UN GESTE — pur, et sans effet de bord.
 *
 * UNE SEULE LIGNE PAR CAPACITÉ, toujours : le geste remplace ce qui existait
 * sur cette capacité-là au lieu de s'empiler dessus. La raison est la règle
 * même du calcul — un retrait l'emporte sur un octroi quel que soit l'ordre —,
 * si bien qu'empiler « accordée » sur « retirée » ne rendrait RIEN et laisserait
 * l'opérateur devant un écran qui ne bouge pas après un geste réussi. On lève,
 * puis on repose : deux lignes au journal, une seule vérité en base.
 *
 * Les dérogations des AUTRES capacités traversent intactes, motif et auteur
 * compris : ce sont des exceptions commerciales distinctes, et ce geste-ci n'en
 * sait rien.
 */
export function appliquerDerogation(
  existantes: readonly unknown[] | null | undefined,
  geste: TenantCapacite & { auteur: string; le: string },
): DerogationCapacite[] {
  const autres = lireDerogations(existantes).filter((d) => d.capacite !== geste.capacite);
  if (geste.geste === 'levee') return autres;
  return [
    ...autres,
    {
      capacite: geste.capacite,
      sens: geste.geste,
      motif: geste.motif,
      auteur: geste.auteur,
      le: geste.le,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// Le refus — une proposition commerciale, pas une porte claquée
// ─────────────────────────────────────────────────────────────

/**
 * Code machine accompagnant le 403 d'une capacité manquante.
 *
 * DISTINCT d'un refus de rôle, qui n'en porte aucun : le front doit pouvoir
 * dire « cette fonction n'est pas dans votre abonnement » plutôt que « vous
 * n'avez pas le droit ». Comparer le libellé français serait un couplage à une
 * phrase qu'on voudra retoucher — même raison qu'`ACCOUNT_SUSPENDED_CODE`.
 */
export const CAPACITE_NON_SOUSCRITE_CODE = 'capacite_non_souscrite';

/**
 * Ce que lit le restaurateur. Il n'y a NI reproche NI nom de formule : la
 * phrase doit rester vraie après le prochain remaniement de l'offre, et le
 * restaurateur n'a pas à apprendre notre grille pour comprendre qu'il lui
 * manque quelque chose. Elle dit ce qui manque, et à qui parler pour l'avoir.
 */
export const capaciteNonSouscriteMessage = (capacite: Capacite): string =>
  `« ${CAPACITE_LABELS[capacite]} » n’est pas comprise dans votre abonnement. ` +
  `Contactez Snack Manager pour l’ajouter.`;

/**
 * L'indication portée par une entrée de navigation VERROUILLÉE.
 *
 * Verrouillée, et non masquée : un client doit voir ce que le produit sait
 * faire, sinon il ne l'achètera jamais — et il vient précisément de lire, sur
 * la grille, que ces modules existent. C'est l'exact inverse d'un refus de
 * RÔLE, qui masque : un équipier n'a pas à savoir ce que fait son patron.
 */
export const CAPACITE_VERROU_INDICE =
  'Non souscrit — contactez Snack Manager pour l’ajouter à votre abonnement';
