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

import type { IconName } from "@/components/ui";
import type { RoleAdmin } from "./session";

export type NavItem = {
  href: string;
  /** LE nom de l'écran — barre de bureau, barre basse et `h1` de l'en-tête. */
  label: string;
  icon: IconName;
  /**
   * Les rôles qui voient l'entrée. Absent = tout le monde.
   *
   * Ce n'est PAS de la sécurité — la garde qui compte est `@Roles(...)` côté
   * API, qui refuse quoi qu'affiche le navigateur (cf. `session.ts`). C'est
   * une politesse : ne pas proposer une porte qu'on fermera au nez.
   */
  roles?: readonly RoleAdmin[];
};

export type NavGroupe = { titre: string; items: readonly NavItem[] };

/**
 * L'écran d'abonnement, nommé à part : c'est le SEUL qui survit à une
 * suspension de compte, et deux règles le désignent plus bas.
 */
export const HREF_ABONNEMENT = "/admin/abonnement";

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
      { href: "/admin/dashboard", label: "Aujourd’hui", icon: "home" },
      { href: "/admin/orders", label: "Commandes", icon: "ticket" },
    ],
  },
  {
    titre: "Carte",
    items: [
      // « Carte », pas « Menu & prix » : c'est déjà le mot qu'emploient la
      // barre basse, la recherche de l'écran et la modale d'import. Le nom
      // était le seul endroit à dire autre chose.
      { href: "/admin/menu", label: "Carte", icon: "grid" },
      // « Stocks » voisine la carte parce que le prix de vente et le coût
      // matière sont le MÊME objet économique : on ne décide pas de l'un sans
      // regarder l'autre. « Ingrédients & stocks » nommait la matière, pas la
      // question qu'on vient s'y poser.
      { href: "/admin/ingredients", label: "Stocks", icon: "fries" },
    ],
  },
  {
    // Ce qui fait REVENIR le mangeur — les trois leviers de la fidélisation,
    // qui se pensent ensemble et se pensaient jusqu'ici à trois endroits
    // éloignés de la liste.
    titre: "Clients",
    items: [
      { href: "/admin/fidelite", label: "Fidélité", icon: "gift" },
      { href: "/admin/promos", label: "Promotions", icon: "tag" },
      { href: "/admin/reviews", label: "Avis", icon: "star" },
    ],
  },
  {
    titre: "Équipe",
    items: [
      { href: "/admin/team", label: "Équipe", icon: "user" },
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
      { href: "/admin/planning", label: "Planning", icon: "check" },
    ],
  },
  {
    // Un seul écran, et un intitulé quand même : le recul sur le service n'est
    // ni du service, ni de l'équipe, ni un réglage. Le ranger ailleurs lui
    // inventerait un propriétaire qu'il n'a pas.
    titre: "Analyse",
    items: [{ href: "/admin/stats", label: "Statistiques", icon: "chart" }],
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
      { href: "/admin/site", label: "Site web", icon: "cart" },
      // « Écrans de salle », pas « Écrans TV » : ce qu'on y règle est le
      // CONTENU diffusé au-dessus du comptoir. Son voisin « Appareils » porte
      // l'APPAIRAGE des caisses et des imprimantes. Les deux écrans restent
      // séparés — c'est leur nommage qui dit enfin la distinction.
      { href: "/admin/screens", label: "Écrans de salle", icon: "tv" },
      // Réservé au propriétaire : `EncaissementController` porte
      // `@Roles('owner')` SUR SA CLASSE — toutes ses routes en héritent. Une
      // session de comptoir voyait l'entrée, cliquait, et recevait un 403.
      {
        href: "/admin/encaissement",
        label: "Encaissement en ligne",
        icon: "euro",
        roles: ["owner"],
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
      { href: HREF_ABONNEMENT, label: "Abonnement", icon: "mail", roles: ["owner"] },
    ],
  },
];

/** La table à plat, dans l'ordre de la barre. */
export const NAV: readonly NavItem[] = NAV_GROUPES.flatMap((g) => g.items);

/**
 * CE QUE LA BARRE SAIT DE LA SESSION — deux faits, pas un de plus.
 *
 * Elle ne lit ni la formule souscrite ni le module de commande en ligne, et ce
 * n'est pas un oubli : AUCUNE route, AUCUN écran du back-office n'est gardé par
 * `plan` ou par `onlineOrdering` aujourd'hui. Ces deux champs ne servent qu'au
 * calcul commercial (devis, facturation, CRM). Masquer une entrée sur leur foi
 * inventerait une dépendance qui n'existe pas, et retirerait au restaurateur un
 * écran que l'API lui ouvre.
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
};

/** Une entrée est-elle proposée dans ce contexte ? */
function estVisible(item: NavItem, ctx: ContexteNav): boolean {
  // La suspension passe AVANT le rôle : elle ferme la maison, pas une pièce.
  // Une session de comptoir sur un compte suspendu ne voit donc RIEN — et
  // c'est exact : l'abonnement lui est fermé aussi, et c'est au propriétaire,
  // depuis son propre compte, de régulariser.
  if (ctx.suspendu && item.href !== HREF_ABONNEMENT) return false;
  if (!item.roles || ctx.role === null) return true;
  return item.roles.includes(ctx.role);
}

/**
 * Les groupes réellement affichés. Un groupe vidé par les règles disparaît
 * avec son intitulé : un titre sans entrée est un cul-de-sac.
 */
export function groupesVisibles(ctx: ContexteNav): readonly NavGroupe[] {
  return NAV_GROUPES.map((g) => ({
    titre: g.titre,
    items: g.items.filter((item) => estVisible(item, ctx)),
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

/** Les cases directes de la barre basse, filtrées comme le reste. */
export function barreMobile(ctx: ContexteNav): readonly NavItem[] {
  return MOBILE_HREFS.map((href) => NAV.find((n) => n.href === href)!).filter((item) =>
    estVisible(item, ctx),
  );
}

/**
 * Le volet « Plus » reprend LES MÊMES GROUPES que la barre de bureau — un écran
 * qu'on a appris à chercher sous « Présence » à l'ordinateur doit se retrouver
 * sous « Présence » au pouce. Il ne rejoue donc pas une liste plate de seize.
 * Les entrées déjà sous le pouce en sont retirées, et les groupes ainsi vidés
 * disparaissent.
 */
export function groupesMobileRestants(ctx: ContexteNav): readonly NavGroupe[] {
  return groupesVisibles(ctx)
    .map((g) => ({
      titre: g.titre,
      items: g.items.filter((item) => !MOBILE_HREFS.includes(item.href)),
    }))
    .filter((g) => g.items.length > 0);
}
