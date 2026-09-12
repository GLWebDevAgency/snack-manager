/**
 * LA NAVIGATION DU CRM INTERNE — et la source du titre de l'en-tête.
 *
 * Elle vit dans son propre module, hors de la coquille, pour la même raison que
 * `admin/fidelite/navigation.ts` : une table de navigation est une DÉCISION
 * d'information, elle se relit et se teste sans monter React.
 *
 * ─── UN SEUL NOM PAR ÉCRAN ───
 *
 * `label` est LE nom : celui de la colonne, celui de la barre basse, et celui
 * que l'en-tête affiche en `h1`. Il n'y a plus de champ `title` distinct —
 * c'est lui qui mentait. Sept entrées sur huit ouvraient un écran qui ne
 * portait pas le mot cliqué : « Clients » donnait « Restaurants clients »,
 * « Signaux » donnait « File de travail », « Pipeline » donnait « Pipeline
 * commercial », et « Vitrine » cumulait trois noms avec `/sm/reseaux` et
 * « Réseaux sociaux de la vitrine ».
 *
 * ─── CINQ GROUPES, PAS HUIT ENTRÉES À PLAT ───
 *
 * Une liste de huit sans intitulé se relit en entier à chaque fois, faute de
 * pouvoir se deviner. Les groupes répondent chacun à une question de la
 * journée : à qui vend-on (Vente), comment va le parc (Parc), qui nous doit de
 * l'argent (Argent), que doit-on livrer (Atelier), qu'est-ce qui tourne sous
 * tout ça (Plateforme).
 *
 * L'unique intitulé « Interne · HQ » disparaît avec la liste plate : il
 * coiffait un fourre-tout, pas un domaine, et cinq intitulés vrais valent mieux
 * qu'un seul qui ne trie rien. L'appartenance à la maison reste dite par le
 * verrouillage en tête de colonne, par l'`aria-label` du `<nav>` et par le
 * sous-titre de l'en-tête.
 *
 * Toute page ajoutée sous `/sm/` doit entrer ici le jour où elle est livrée :
 * une page absente hérite du titre de l'accueil et surligne le mauvais lien.
 */

import type { IconName } from "@/components/ui";

export type NavItem = {
  href: string;
  /** LE nom de l'écran — colonne, barre basse et `h1` de l'en-tête. */
  label: string;
  icon: IconName;
  /**
   * Libellé de la BARRE BASSE, quand le nom complet ne tient pas dans les
   * ~70 px d'une cellule à cinq colonnes. Il est DÉCLARÉ ici, jamais coupé au
   * rendu : « Tableau de bord » y était rogné en « Tableau », un mot qui ne
   * nomme rien. Un nom court explicite vaut mieux qu'une phrase amputée.
   */
  court?: string;
};

export type NavGroupe = { titre: string; items: readonly NavItem[] };

/**
 * LE TABLEAU DE BORD EST EN TÊTE ET HORS GROUPE.
 *
 * Il n'appartient à aucun des cinq domaines : il les résume tous — les appels
 * du jour, le MRR, les places fondateur, l'entonnoir, le parc. Le ranger sous
 * « Vente » ou sous « Parc » lui inventerait un propriétaire qu'il n'a pas, et
 * lui donner un groupe à lui seul poserait un intitulé qui ne ferait que
 * répéter l'entrée. Il se pose donc au-dessus des intitulés, comme la ligne
 * d'accueil qu'il est.
 */
export const NAV_ACCUEIL: NavItem = {
  href: "/sm",
  label: "Tableau de bord",
  icon: "chart",
  court: "Accueil",
};

export const NAV_GROUPES: readonly NavGroupe[] = [
  {
    titre: "Vente",
    items: [
      // « Prospection », pas « Pipeline » : c'est le mot français du geste, et
      // celui que l'écran emploie déjà dans sa recherche (« Rechercher un
      // prospect… »). La route `/sm/pipeline` et le type `CrmLead` ne bougent
      // pas — on renomme ce qui se lit, pas ce qui s'exécute.
      { href: "/sm/pipeline", label: "Prospection", icon: "users" },
    ],
  },
  {
    titre: "Parc",
    items: [
      { href: "/sm/clients", label: "Restaurants", icon: "store" },
      // « File du jour » : le nom dit ce qu'on en fait — une file se vide dans
      // la journée. « Signaux » nommait la matière première, pas le geste.
      { href: "/sm/signals", label: "File du jour", icon: "bell" },
    ],
  },
  {
    titre: "Argent",
    items: [{ href: "/sm/facturation", label: "Facturation", icon: "euro" }],
  },
  {
    titre: "Atelier",
    items: [{ href: "/sm/production", label: "Production", icon: "check" }],
  },
  {
    titre: "Plateforme",
    items: [
      { href: "/sm/erreurs", label: "Erreurs", icon: "alert" },
      // LE ROUAGE A DISPARU D'ICI. Partout ailleurs dans le produit il annonce
      // les RÉGLAGES ; cet écran-là n'en est pas un — il MET EN LIGNE la
      // vitrine commerciale. Le globe fourni par le kit désigne le site
      // public ; aucune autre entrée ne le porte (le test le vérifie).
      { href: "/sm/reseaux", label: "Vitrine Snack Manager", icon: "globe" },
    ],
  },
];

/** La table à plat, dans l'ordre de la colonne. */
export const NAV: readonly NavItem[] = [
  NAV_ACCUEIL,
  ...NAV_GROUPES.flatMap((g) => g.items),
];

/** Le libellé de la barre basse — déclaré dans la table, jamais tronqué. */
export function libelleCourt(item: NavItem): string {
  return item.court ?? item.label;
}

/**
 * L'écran actif — celui qui surligne son lien et titre l'en-tête.
 *
 * Le tri par longueur décroissante fait gagner la route la plus précise :
 * `/sm/clients/abc` doit désigner « Restaurants », pas l'accueil. `/sm` est
 * exact par construction, sinon il capterait tout le CRM.
 */
export function navActive(pathname: string): NavItem {
  return (
    [...NAV]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => (n.href === "/sm" ? pathname === "/sm" : pathname.startsWith(n.href))) ??
    NAV_ACCUEIL
  );
}

/**
 * LA BARRE BASSE ne porte que CINQ cellules — la règle des grandes
 * applications mobiles, et elle n'est pas esthétique : à six, chaque cible
 * passe sous les 44 px de pouce sur un écran de 390. Les quatre gestes
 * quotidiens (regarder, vendre, suivre, encaisser) + « Plus », qui ouvre le
 * reste. Les entrées sont TIRÉES de la table, jamais recopiées : un nom qui
 * change change aux deux endroits.
 */
const MOBILE_NAV_HREFS: readonly string[] = [
  "/sm",
  "/sm/pipeline",
  "/sm/clients",
  "/sm/facturation",
];

export const MOBILE_NAV: readonly NavItem[] = MOBILE_NAV_HREFS.map(
  (href) => NAV.find((n) => n.href === href)!,
);

/**
 * La feuille « Plus » reprend LES MÊMES GROUPES que la colonne de bureau — un
 * écran qu'on a appris à chercher sous « Plateforme » au bureau doit se
 * retrouver sous « Plateforme » au pouce. Les groupes que la barre basse a
 * vidés (Vente, Argent, dont l'unique entrée est déjà sous le pouce) ne sont
 * pas rendus : un intitulé sans entrée est un cul-de-sac.
 */
export const MOBILE_MORE_GROUPES: readonly NavGroupe[] = NAV_GROUPES.map((g) => ({
  titre: g.titre,
  items: g.items.filter((n) => !MOBILE_NAV_HREFS.includes(n.href)),
})).filter((g) => g.items.length > 0);

/** À plat : ce que « Plus » contient — sert à l'allumer quand on y est. */
export const MOBILE_MORE: readonly NavItem[] = MOBILE_MORE_GROUPES.flatMap((g) => g.items);
