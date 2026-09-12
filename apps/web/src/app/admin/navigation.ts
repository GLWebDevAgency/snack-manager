/**
 * LA NAVIGATION DU BACK-OFFICE RESTAURATEUR — et la source du titre de l'écran.
 *
 * Elle vit dans son propre module, hors de la coque, pour la même raison que
 * `sm/navigation.ts` et `admin/fidelite/navigation.ts` : une table de
 * navigation est une DÉCISION d'information, elle se relit et se teste sans
 * monter React.
 *
 * ─── SEPT GROUPES, PAS SEIZE ENTRÉES À PLAT ───
 *
 * La barre alignait seize entrées sous un unique intitulé « Gestion », dans un
 * ordre né de l'ordre de livraison des écrans. Trois conséquences mesurées :
 *
 *  · ONZE écrans sur vingt n'avaient AUCUN lien entrant ailleurs dans le
 *    produit. Le restaurateur qui ne balayait pas la liste entière ne les
 *    trouvait jamais — la liste ÉTAIT la seule porte, et une liste de seize ne
 *    se devine pas, elle se relit en entier à chaque fois ;
 *  · l'écran des paramètres n'était dans AUCUNE liste : on ne l'atteignait que
 *    par une icône de rouage sans libellé, en pied de barre, collée au bouton
 *    de déconnexion. La barre de titre affichait alors « Back-office », faute
 *    d'entrée correspondante — le seul écran du produit sans nom ;
 *  · « Gestion » ne triait rien. Un intitulé qui coiffe tout ne dit rien.
 *
 * Chaque groupe répond à une question de la journée : que se passe-t-il
 * maintenant (Service), que vend-on et avec quoi (Carte), qu'est-ce qui fait
 * revenir le mangeur (Clients), qui travaille et quand (Équipe), où en est-on
 * (Analyse), que voit le public (Présence), qu'a-t-on réglé une fois pour
 * toutes (Réglages).
 *
 * AUCUN écran n'est fusionné, AUCUNE route ne bouge : c'est une refonte
 * d'information, pas de fonctionnalité.
 *
 * ─── UN SEUL NOM PAR ÉCRAN ───
 *
 * `label` est LE nom : celui de la barre de bureau, celui de la barre basse, et
 * celui que la barre de titre affiche en `h1`. Il n'existe aucun champ de titre
 * séparé, et aucune table de libellés courts à côté — c'est justement ce qui
 * faisait diverger les noms : « Menu & prix » dans la colonne devenait
 * « Carte » sous le pouce, « Tableau de bord » devenait « Accueil ». Les deux
 * écrans portent désormais le nom court dans la table elle-même, et il n'y a
 * plus de second nom nulle part.
 *
 * Toute page ajoutée sous `/admin/` doit entrer ici le jour où elle est livrée.
 * Le test le vérifie en lisant le dossier : un écran livré sans entrée est un
 * écran que personne n'ouvrira.
 */

import type { Capacite } from "@sm/contracts";
import { BACKOFFICE_ACCESS, canAccessArea, type BackofficeArea } from "@sm/contracts/commerce";
import type { IconName } from "@/components/ui";
import type { RoleAdmin } from "./session";

export type NavItem = {
  href: string;
  /** LE nom de l'écran — barre de bureau, barre basse et `h1` de l'en-tête. */
  label: string;
  icon: IconName;
  /**
   * Les rôles qui voient l'entrée. Absent = tous les rôles OPÉRATIONNELS.
   *
   * Ce n'est PAS de la sécurité — la garde qui compte est `@Roles(...)` côté
   * API, qui refuse quoi qu'affiche le navigateur (cf. `session.ts`). C'est
   * une politesse : ne pas proposer une porte qu'on fermera au nez.
   *
   * ── POURQUOI « ABSENT » NE VEUT PLUS DIRE « TOUT LE MONDE » ──
   *
   * Cinq des six rôles travaillent DANS le service : ils ouvrent des écrans,
   * l'un plus que l'autre, et le défaut « visible » leur convient — au pire une
   * entrée de trop. Le sixième, `comptable`, ne peut RIEN ouvrir de ce qui
   * n'est pas explicitement à lui : le défaut lui proposerait quinze portes
   * pour quinze refus, ce qui n'est plus une imprécision d'affichage mais un
   * écran qui ment. La liste des rôles opérationnels vit ci-dessous.
   */
  roles?: readonly RoleAdmin[];
  /**
   * LE MODULE DE LA GRILLE TARIFAIRE qui ouvre cet écran. Absent = le socle.
   *
   * Second critère, et de nature TOTALEMENT différente du premier : `roles`
   * dit qui a le droit, `capacite` dit ce que l'établissement a payé. D'où
   * deux traitements opposés, et c'est la décision centrale de cette table :
   *
   *  · une entrée refusée par le RÔLE est MASQUÉE. Un équipier de cuisine n'a
   *    pas à savoir que l'écran d'abonnement existe : ce n'est pas son métier,
   *    et le lui montrer ne lui apprend rien d'utile ;
   *  · une entrée non SOUSCRITE reste VISIBLE et VERROUILLÉE. Le restaurateur
   *    vient de lire, sur notre grille tarifaire, que ces modules existent —
   *    les faire disparaître de son back-office serait lui cacher ce qu'il
   *    peut acheter. On ne vend pas ce qu'on cache.
   *
   * Absent quand la matrice publiée ne couvre PAS l'écran (`apps/web/src/
   * components/marketing/content.ts`, `PLAN_MODULES`) : les avis, les écrans
   * de salle, le site, l'équipe, les réglages, les horaires, les appareils et
   * l'abonnement n'y ont pas de ligne. Rien ne leur a donc été promis, et rien
   * ne doit leur être retiré — leur inventer un module fermerait une porte sur
   * une promesse que personne n'a faite.
   */
  capacite?: Capacite;
};

export type NavGroupe = { titre: string; items: readonly NavItem[] };

/**
 * Une entrée telle que la barre la PEINT — avec son verrou.
 *
 * `verrouille` n'est pas un champ de la table : il dépend de la session, il se
 * calcule à chaque rendu. Le distinguer de `NavItem` évite qu'un appelant
 * croie lire une propriété de l'écran alors qu'il lit un fait du restaurant.
 */
export type NavItemAffiche = NavItem & { verrouille: boolean };
export type NavGroupeAffiche = { titre: string; items: readonly NavItemAffiche[] };

/**
 * L'écran d'abonnement, nommé à part : c'est le SEUL qui survit à une
 * suspension de compte, et deux règles le désignent plus bas.
 */
export const HREF_ABONNEMENT = "/admin/abonnement";

/**
 * LES RÔLES QUI FONT TOURNER LE SERVICE.
 *
 * Ce sont eux que sert le défaut « pas de `roles` sur l'entrée = visible » :
 * ils ouvrent des écrans, l'un plus que l'autre, et une entrée de trop leur
 * coûte au pire un refus lisible.
 *
 * `comptable` n'y est PAS, et c'est toute la règle : il ne fait rien tourner,
 * il lit l'argent. Tout ce qu'il peut ouvrir est donc NOMMÉ entrée par entrée
 * (aujourd'hui les statistiques et l'abonnement), et le reste lui est masqué au
 * lieu de lui être proposé pour rien.
 */
export const ROLES_OPERATIONNELS: readonly RoleAdmin[] = [
  "owner",
  "cogerant",
  "gerant",
  "caisse",
  "cuisine",
];

export const NAV_GROUPES: readonly NavGroupe[] = [
  {
    // Ce qui se passe MAINTENANT. Les deux écrans qu'un gérant ouvre en
    // arrivant le matin et laisse ouverts pendant le coup de feu.
    titre: "Service",
    items: [
      // « Aujourd'hui », pas « Tableau de bord » : l'écran ne montre pas des
      // tableaux, il montre LA JOURNÉE — le chiffre du jour, l'objectif, les
      // commandes en cours. Et le nom tient sous le pouce, ce qui supprime le
      // libellé court « Accueil » qui le doublait dans la barre basse.
      { href: "/admin/dashboard", label: "Aujourd’hui", icon: "grid", capacite: "bo" },
      { href: "/admin/orders", label: "Commandes", icon: "ticket", capacite: "bo" },
      { href: "/admin/livraison", label: "Livraison", icon: "truck", capacite: "delivery", roles: ["owner", "gerant", "cogerant"] },
    ],
  },
  {
    titre: "Carte",
    items: [
      // « Carte », pas « Menu & prix » : c'est déjà le mot qu'emploient la
      // barre basse, la recherche de l'écran et la modale d'import. Le nom
      // était le seul endroit à dire autre chose.
      { href: "/admin/menu", label: "Carte", icon: "menu", capacite: "menu" },
      // « Stocks » voisine la carte parce que le prix de vente et le coût
      // matière sont le MÊME objet économique : on ne décide pas de l'un sans
      // regarder l'autre. « Ingrédients & stocks » nommait la matière, pas la
      // question qu'on vient s'y poser.
      { href: "/admin/ingredients", label: "Stocks", icon: "box", capacite: "stocks" },
    ],
  },
  {
    // Ce qui fait REVENIR le mangeur — les trois leviers de la fidélisation,
    // qui se pensent ensemble et se pensaient jusqu'ici à trois endroits
    // éloignés de la liste.
    titre: "Clients",
    items: [
      { href: "/admin/fidelite", label: "Fidélité", icon: "gift", capacite: "loyalty" },
      { href: "/admin/promos", label: "Promotions", icon: "tag", capacite: "loyalty" },
      { href: "/admin/reviews", label: "Avis", icon: "star" },
    ],
  },
  {
    titre: "Équipe",
    items: [
      { href: "/admin/team", label: "Équipe", icon: "users" },
      // Le planning répond à l'équipe : là on badge ce qui s'est passé, ici on
      // décide ce qui va se passer. L'écart entre prévu et pointé est
      // justement ce que le planning affiche.
      //
      // Il n'est PAS réservé au propriétaire, alors que l'API le sert à
      // `owner` et `gerant` : l'écran se dégrade déjà seul — les coûts
      // horaires et la masse salariale ne descendent qu'au propriétaire
      // (`payroll-access.ts`), et la semaine publiée est faite pour être lue
      // par les salariés. Masquer l'entrée retirerait à un équipier la seule
      // page qui lui dit quand il travaille.
      { href: "/admin/planning", label: "Planning", icon: "calendar", capacite: "planning" },
    ],
  },
  {
    // Un seul écran, et un intitulé quand même : le recul sur le service n'est
    // ni du service, ni de l'équipe, ni un réglage. Le ranger ailleurs lui
    // inventerait un propriétaire qu'il n'a pas.
    titre: "Analyse",
    items: [
      // Le SEUL écran de service ouvert au comptable : le chiffre d'affaires,
      // les canaux et les deux exports CSV — le fichier qu'il ouvre dans un
      // tableur. Les cinq autres rôles y entrent aussi, d'où la liste complète
      // plutôt qu'une absence de `roles` : sans elle, l'entrée resterait
      // proposée à qui ne peut ouvrir que celle-ci et l'abonnement.
      {
        href: "/admin/stats",
        label: "Statistiques",
        icon: "chart",
        capacite: "bo",
        roles: [...ROLES_OPERATIONNELS, "comptable"],
      },
    ],
  },
  {
    // CE QUE LE PUBLIC VOIT du restaurant, et par où il paie. Les trois
    // surfaces tournées vers le dehors : l'adresse de commande, l'écran
    // accroché en salle, et le raccordement qui rend la commande encaissable.
    titre: "Présence",
    items: [
      // « Site web » : la page était complète — adresse, nom de domaine, état
      // de propagation DNS — et le restaurateur qui achetait un domaine ne
      // pouvait l'atteindre qu'en connaissant l'URL par cœur.
      { href: "/admin/site", label: "Site web", icon: "globe" },
      // « Écrans de salle », pas « Écrans TV » : ce qu'on y règle est le
      // CONTENU diffusé au-dessus du comptoir. Son voisin « Appareils » porte
      // l'APPAIRAGE des caisses et des imprimantes. Les deux écrans restent
      // séparés — c'est leur nommage qui dit enfin la distinction.
      { href: "/admin/screens", label: "Écrans de salle", icon: "tv" },
      // Réservé au propriétaire : `EncaissementController` porte
      // `@Roles('owner')` SUR SA CLASSE — toutes ses routes en héritent. Une
      // session de comptoir voyait l'entrée, cliquait, et recevait un 403.
      // LES DEUX AXES SUR LA MÊME ENTRÉE, et c'est la seule de la barre.
      // `roles` la masque à une session de comptoir (`EncaissementController`
      // porte `@Roles('owner')`) ; `capacite` la VERROUILLE, sans la masquer,
      // pour un propriétaire dont la formule ne comprend pas la commande en
      // ligne — le raccordement Stripe n'existe que pour encaisser ces
      // commandes-là, et l'API le refuse désormais franchement.
      {
        href: "/admin/encaissement",
        label: "Encaissement en ligne",
        icon: "euro",
        roles: ["owner"],
        capacite: "online",
      },
    ],
  },
  {
    // Ce qu'on règle une fois puis presque jamais. Le groupe existe d'abord
    // pour que « Établissement » ait enfin un nom et une place : il n'était
    // dans aucune liste.
    titre: "Réglages",
    items: [
      { href: "/admin/settings", label: "Établissement", icon: "gear" },
      { href: "/admin/hours", label: "Horaires et créneaux", icon: "clock" },
      // « Appareils », pas « Caisses & cuisine » : on y appaire des tablettes
      // et des imprimantes, et l'écran est un réglage d'installation — pas un
      // geste de service. Il quitte donc le voisinage des écrans de salle.
      { href: "/admin/devices", label: "Appareils", icon: "print" },
      // Réservé au propriétaire : `MyBillingController` s'authentifie par
      // `TenantSessionGuard`, qui exige `kind: 'user'` ET `role: 'owner'` —
      // les factures du patron ne s'ouvrent pas depuis la tablette du
      // comptoir. Dernier de la liste, et c'est voulu : on y vient deux fois
      // par an, mais la FAQ promet mot pour mot d'y retrouver ses factures.
      // Le comptable y entre avec le propriétaire, et personne d'autre :
      // `TenantSessionGuard` accepte exactement ces deux rôles
      // (`ROLES_LECTURE_FACTURATION`, côté API). Un cogérant ne voit pas
      // l'abonnement — il tient le service, il ne négocie pas le contrat.
      {
        href: HREF_ABONNEMENT,
        label: "Abonnement",
        icon: "mail",
        roles: ["owner", "comptable"],
      },
    ],
  },
];

/** La table à plat, dans l'ordre de la barre. */
export const NAV: readonly NavItem[] = NAV_GROUPES.flatMap((g) => g.items);

/**
 * CE QUE LA BARRE SAIT DE LA SESSION — trois faits, pas un de plus.
 *
 * Elle ne lit JAMAIS la formule souscrite, et c'est la règle d'or du produit :
 * le code ne connaît pas le nom d'une formule, il connaît des capacités. Le
 * serveur calcule la liste (`GET /tenants/me` → `capacites`), la barre la
 * consomme. Rejouer le catalogue ici en ferait une seconde copie, qui
 * divergerait de l'API au premier changement d'offre — la moitié des écrans
 * verrouillés d'un côté, ouverts de l'autre, sans qu'un test ne rougisse.
 */
export type ContexteNav = {
  /**
   * Le rôle de la session, ou `null` quand on ne le connaît pas.
   *
   * `null` arrive pour de vrai : en démonstration (`?demo=1`), le jeton est
   * `null` par conception (cf. `session.ts`). La barre est alors COMPLÈTE —
   * masquer des entrées montrerait un logiciel vide à qui vient le regarder,
   * et il n'y a rien à protéger dans un établissement de fixture.
   */
  role: RoleAdmin | null;
  /**
   * Compte suspendu pour impayé.
   *
   * La suspension ferme TOUT le back-office : `AuthGuard` refuse chaque requête
   * du parc avant même le contrôle de rôle. Le seul écran qui survit est
   * l'abonnement, servi par un garde dédié (`TenantSessionGuard`) précisément
   * pour que le gérant lise le montant et la référence à virer. Proposer les
   * seize autres entrées, c'est proposer seize refus.
   */
  suspendu: boolean;
  /**
   * CE QUE L'ÉTABLISSEMENT A SOUSCRIT — la liste, calculée par le serveur.
   *
   * `null` quand on ne sait pas encore, et les deux cas arrivent pour de vrai :
   * la démonstration (aucun jeton, aucun appel) et l'instant qui précède la
   * réponse de `GET /tenants/me`. Rien n'est alors verrouillé — un verrou qui
   * apparaît une seconde après le chargement fait clignoter la barre, et
   * verrouiller par défaut punirait un client en règle pour la lenteur du
   * réseau. C'est la même règle que pour `role`, et pour la même raison :
   * l'autorité est côté API, ici on ne fait que ne pas mentir.
   */
  capacites: readonly Capacite[] | null;
};

/** Une entrée est-elle proposée dans ce contexte ? */
function estVisible(item: NavItem, ctx: ContexteNav): boolean {
  // La suspension passe AVANT le rôle : elle ferme la maison, pas une pièce.
  // Une session de comptoir sur un compte suspendu ne voit donc RIEN — et
  // c'est exact : l'abonnement lui est fermé aussi, et c'est au propriétaire,
  // depuis son propre compte, de régulariser.
  if (ctx.suspendu && item.href !== HREF_ABONNEMENT) return false;
  // Rôle inconnu (démonstration) : la barre reste COMPLÈTE — masquer des
  // entrées montrerait un logiciel vide à qui vient le regarder.
  if (ctx.role === null) return true;
  if (item.roles) return item.roles.includes(ctx.role);
  // Aucune liste sur l'entrée : le défaut ne vaut que pour les rôles qui font
  // tourner le service. Voir `ROLES_OPERATIONNELS`.
  return ROLES_OPERATIONNELS.includes(ctx.role);
}

/**
 * L'entrée est-elle VERROUILLÉE — visible, mais fermée faute d'abonnement ?
 *
 * Jamais masquée, et le contraste avec `estVisible` est tout le propos : un
 * refus de droit se tait, un défaut de souscription se montre. La différence
 * n'est pas une nuance d'interface, c'est la différence entre « ce n'est pas
 * votre métier » et « voilà ce que vous pourriez avoir ».
 */
function estVerrouille(item: NavItem, ctx: ContexteNav): boolean {
  if (ctx.capacites === null) return false;
  const area = item.href.split("/")[2] as BackofficeArea;
  if (area in BACKOFFICE_ACCESS) return !canAccessArea(area, ctx.capacites);
  return Boolean(item.capacite && !ctx.capacites.includes(item.capacite));
}

/** URL directes comprises : la navigation et la coque relisent le même accès. */
export function accesPage(pathname: string, ctx: ContexteNav): "allowed" | "locked" | "forbidden" {
  const item = NAV.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  if (!item) return "allowed";
  if (!estVisible(item, ctx)) return "forbidden";
  return estVerrouille(item, ctx) ? "locked" : "allowed";
}

/** La première fonction réellement utilisable, jamais une vente additionnelle à la connexion. */
export function accueilAdmin(ctx: ContexteNav): string | null {
  return NAV.find((item) => estVisible(item, ctx) && !estVerrouille(item, ctx))?.href ?? null;
}

const affiche = (item: NavItem, ctx: ContexteNav): NavItemAffiche => ({
  ...item,
  verrouille: estVerrouille(item, ctx),
});

/**
 * Les groupes réellement affichés. Un groupe vidé par les règles disparaît
 * avec son intitulé : un titre sans entrée est un cul-de-sac.
 *
 * Une entrée VERROUILLÉE ne vide rien : elle reste dans son groupe, avec son
 * nom et son icône, et porte seulement `verrouille: true`. C'est la barre qui
 * décide comment le dire ; la table dit seulement que c'est le cas.
 */
export function groupesVisibles(ctx: ContexteNav): readonly NavGroupeAffiche[] {
  return NAV_GROUPES.map((g) => ({
    titre: g.titre,
    items: g.items.filter((item) => estVisible(item, ctx)).map((item) => affiche(item, ctx)),
  })).filter((g) => g.items.length > 0);
}

/**
 * L'écran actif — celui qui surligne son lien et titre l'en-tête.
 *
 * Cherché dans la table ENTIÈRE, jamais dans les entrées visibles : un écran
 * que la barre masque garde son nom si on y arrive par une adresse, et
 * « Back-office » ne doit plus jamais servir de titre.
 *
 * Le tri par longueur décroissante fait gagner la route la plus précise ;
 * `/admin/fidelite/clients` doit désigner « Fidélité », pas l'accueil.
 */
export function navActive(pathname: string): NavItem {
  return [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => pathname.startsWith(n.href)) ?? NAV[0]!;
}

/**
 * LA BARRE BASSE : trois cases directes et « Plus », soit quatre cellules de
 * ±97 px sur un écran de 390 — largement au-dessus des 44 px de pouce.
 *
 * Ce sont les pages qu'un gérant ouvre CHAQUE JOUR depuis son téléphone : lire
 * le service, suivre les commandes, mettre un produit en rupture. La règle
 * autorise une quatrième case ; aucune quatrième page ne s'ouvre chaque jour,
 * et une case de plus rétrécit les quatre autres pour rien.
 *
 * Les entrées sont TIRÉES de la table, jamais recopiées : un nom qui change
 * change aux deux endroits. Et comme les trois noms tiennent tels quels, il
 * n'existe aucun libellé court — donc plus aucun nom qui diverge.
 */
export const MOBILE_HREFS: readonly string[] = [
  "/admin/dashboard",
  "/admin/orders",
  "/admin/menu",
];

/** Les fonctions utilisées passent avant les propositions commerciales sous le pouce. */
export function barreMobile(ctx: ContexteNav): readonly NavItemAffiche[] {
  if (ctx.suspendu) return [];
  const priorites = MOBILE_HREFS.map((href) => NAV.find((n) => n.href === href)!);
  return [...priorites, ...NAV.filter((item) => !MOBILE_HREFS.includes(item.href))]
    .filter((item) => estVisible(item, ctx) && !estVerrouille(item, ctx))
    .slice(0, 3)
    .map((item) => affiche(item, ctx));
}

/**
 * Le volet « Plus » reprend LES MÊMES GROUPES que la barre de bureau — un écran
 * qu'on a appris à chercher sous « Présence » à l'ordinateur doit se retrouver
 * sous « Présence » au pouce. Il ne rejoue donc pas une liste plate de seize.
 * Les entrées déjà sous le pouce en sont retirées, et les groupes ainsi vidés
 * disparaissent.
 */
export function groupesMobileRestants(ctx: ContexteNav): readonly NavGroupeAffiche[] {
  const directs = new Set(barreMobile(ctx).map((item) => item.href));
  return groupesVisibles(ctx)
    .map((g) => ({
      titre: g.titre,
      items: g.items.filter((item) => !directs.has(item.href)),
    }))
    .filter((g) => g.items.length > 0);
}
