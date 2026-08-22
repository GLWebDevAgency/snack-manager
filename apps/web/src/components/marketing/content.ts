/**
 * Copy du site vitrine — source unique, en français.
 *
 * ═══ LA RÈGLE QUI PRIME SUR TOUTES LES AUTRES ═══
 *
 * On n'écrit ici QUE ce que le produit tient aujourd'hui. Pas un chiffre de
 * résultat (nous n'avons aucun client hors du pilote, donc aucun résultat à
 * montrer), pas un témoignage, pas un compteur de places prises, et jamais
 * un mot qui laisse entendre qu'on fournit des livreurs : le tunnel de
 * commande s'arrête au CRÉNEAU DE RETRAIT.
 *
 * La page est découpée en onze sections, une par question que se pose un
 * patron de snack, dans l'ordre où il se la pose. `SECTIONS` porte cet ordre
 * et sert à la fois de sommaire (menu burger) et de source des titres.
 */

// `import type` UNIQUEMENT : effacé à la compilation, donc zod ne descend pas
// dans le paquet client de la page d'accueil. Voir `GRILLES_ACCORDÉES`.
import type { PLAN_MRR_CENTS as PlanMrrCents } from "@sm/contracts";

export const CONTACT_EMAIL = "contact@snackmanager.fr";

/**
 * LA CLAUSE D'ENGAGEMENT — DÉCISION DU FONDATEUR, UN SEUL TEXTE.
 *
 * Elle est une CONSTANTE et non une phrase recopiée, parce que la page se
 * contredisait à voix haute : le hero affichait « Sans engagement » pendant
 * que la FAQ répondait « on vous détaille les conditions au moment du devis ».
 * Un prospect qui attrape les deux ne croit plus ni l'une ni l'autre.
 *
 * Partout où la question se pose — bandeau sous la grille tarifaire, FAQ — on
 * affiche CETTE valeur, jamais une reformulation. Le forfait de mise en route
 * est dit dans la même phrase que l'absence d'engagement : le taire ferait de
 * « sans engagement » un demi-mensonge découvert au devis.
 */
export const ENGAGEMENT =
  "Abonnement sans engagement, résiliable à tout moment. S'y ajoute un forfait de mise en route, non remboursable, qui couvre les journées d'installation.";

/* ── Les montants — la grille, et rien qu'elle ───────────────── */

/**
 * ═══ TOUS LES PRIX DE LA PAGE NAISSENT ICI, ET EN CENTIMES ═══
 *
 * Ils étaient recopiés à la main dans une dizaine de chaînes — les trois
 * formules, le titre du simulateur, le service vendu à part, l'addition de
 * pied de section, la description qui part chez Google — et la révision de
 * grille du 21/08/2026 a montré ce que ça coûte : il a fallu les retrouver une
 * par une, et l'addition, elle, additionnait encore les tarifs de l'année
 * dernière en oubliant les 55 € de mise en service. La page se trompait dans
 * son propre calcul, sous les yeux du prospect, à l'endroit exact où on lui
 * demande de nous faire confiance.
 *
 * Un montant ne s'écrit donc plus qu'une fois. En CENTIMES, comme partout
 * ailleurs dans le produit : une addition d'euros flottants finit par afficher
 * un centime qui n'existe pas.
 *
 * ═══ ET CE N'EST PAS LA SOURCE DE VÉRITÉ ═══
 *
 * Celle-là est `PLAN_MRR_CENTS`, dans `packages/contracts/src/crm.ts` : c'est
 * elle que lisent le CRM et la facturation, c'est elle qui édite les factures.
 * On ne l'IMPORTE pas ici, et c'est un arbitrage assumé : `crm.ts` embarque
 * zod, `content.ts` est lu par des composants clients (`Hero`, `Faq`,
 * `Simulator`), et le paquet n'expose pas de sous-chemin — l'import ferait
 * descendre un validateur de schémas entier dans le JavaScript de la page
 * d'accueil pour trois nombres.
 *
 * Les valeurs sont donc recopiées, et c'est le SEUL endroit de la vitrine où
 * elles le sont. Une révision de grille se fait dans ces deux fichiers, jamais
 * dans un troisième.
 */
export const PLAN_MONTHLY_CENTS = {
  essentiel: 9_900,
  complet: 15_900,
  boost: 19_900,
} as const;

/**
 * LE GARDE-FOU QUI REND LA RECOPIE HONNÊTE.
 *
 * Recopier une grille de prix sans rien pour vérifier qu'elle concorde, c'est
 * se garantir qu'un jour la vitrine annoncera un tarif et la facture en portera
 * un autre — sans qu'un seul test bronche, et sans que personne le voie avant
 * un client mécontent.
 *
 * `import type` est EFFACÉ à la compilation : zod ne descend pas dans le paquet
 * client de la page d'accueil, et la vérification ne coûte pas un octet à
 * l'exécution. Elle coûte en revanche une erreur de typecheck franche le jour
 * où l'une des deux tables bouge sans l'autre, ce qui est précisément le prix
 * qu'on veut payer.
 */
type MêmeGrille<A, B> = A extends B ? (B extends A ? true : false) : false;

export const GRILLES_ACCORDÉES: MêmeGrille<typeof PLAN_MONTHLY_CENTS, typeof PlanMrrCents> = true;

/**
 * Le module vendu à part et sa mise en service.
 *
 * La mise en service n'est due qu'UNE FOIS, et jamais sur Boost qui la
 * comprend. Elle a longtemps vécu dans le seul texte de la section services :
 * l'addition de la grille l'ignorait donc, et se trompait de 55 €.
 */
export const MODULE_MONTHLY_CENTS = 7_900;
export const MODULE_SETUP_CENTS = 5_500;

/**
 * LES DEUX PRESTATIONS AU DEVIS — ET ELLES SONT DES NOMBRES, MAINTENANT.
 *
 * L'identité visuelle et l'installation du matériel ne vivaient QUE dans deux
 * chaînes libres : `"À partir de 250 €"` dans `SERVICES`, `"À partir de 290 €"`
 * dans `HARDWARE_PATHS`. C'est-à-dire les deux derniers prix de la vitrine
 * qu'une révision de grille menée ici laissait intacts — la faute même que ce
 * bloc de constantes existe pour empêcher, simplement rangée mille lignes plus
 * bas où personne ne la cherchait.
 *
 * Elle avait déjà une conséquence visible : `euros()` compose avec une espace
 * INSÉCABLE devant le symbole, quand ces deux chaînes portaient une espace
 * ordinaire. La même page affichait donc « 99 € » qui ne se coupe jamais en fin
 * de ligne et « 250 € » qui pouvait laisser le symbole seul sur la ligne
 * suivante.
 *
 * Ce n'est PAS une troisième grille : la grille, ce sont les trois abonnements
 * et le module, et elle ne bouge pas. Ce sont deux prestations facturées une
 * fois, sur devis — d'où « à partir de », qui est un plancher et non un tarif.
 */
export const IDENTITE_FROM_CENTS = 25_000;
export const INSTALL_FROM_CENTS = 29_000;

/**
 * L'ENGAGEMENT ANNUEL — douze mois payés dix.
 *
 * Même règle que les contrats (`YEARLY_MONTHS_BILLED`, `crm.ts`), et l'annuel
 * se DÉDUIT toujours du mensuel : deux grilles saisies à la main finissent par
 * diverger, et c'est le genre d'écart qu'on découvre sur une facture.
 *
 * « Deux mois offerts » plutôt que « −16,7 % » : le premier se retient, le
 * second se vérifie — et un prospect qui sort sa calculette devant une page de
 * prix ne la sort jamais en notre faveur.
 */
export const YEARLY_MONTHS_BILLED = 10;
export const yearlyCents = (monthlyCents: number): number => monthlyCents * YEARLY_MONTHS_BILLED;

/**
 * FORMATAGE MAISON, ET SÛREMENT PAS `toLocaleString`.
 *
 * Même raison que dans `Simulator.tsx` : le séparateur de milliers de l'ICU
 * français a changé d'espace selon les versions, et un écart d'un caractère
 * entre le rendu serveur et le rendu navigateur casse l'hydratation de la
 * page entière.
 *
 * Les centimes ne s'écrivent que s'il y en a : « 159 € » dans une grille de
 * prix, « 132,50 € » quand l'année ramenée au mois tombe sur un demi-euro.
 * « 159,00 € » a l'air d'une facture, pas d'un tarif.
 */
/*
 * EXPORTÉES, PARCE QUE LES REDÉCLARER A DÉJÀ COÛTÉ LA TYPOGRAPHIE DU
 * SIMULATEUR.
 *
 * `Simulator.tsx` portait sa propre paire, sous les mêmes noms, avec deux
 * espaces ORDINAIRES dedans : à l'œil, une insécable et une espace normale
 * sont le même caractère. La faute a donc traversé toutes les relectures, et
 * tous les montants du simulateur sortaient sécables — un « 505 € » qui se
 * coupe en fin de ligne, un « 6 065 » coupé entre le millier et les centaines.
 *
 * Un seul endroit les déclare maintenant, et le simulateur les importe. Ce
 * n'est pas de l'économie de lignes : c'est le seul moyen qu'une divergence
 * invisible redevienne impossible.
 */
export const NARROW_NBSP = " "; // milliers : « 2 911 € » ne se coupe pas en fin de ligne
export const NBSP = " "; // devant le symbole — typographie française

export function euros(cents: number): string {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const units = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  const decimals = abs % 100;
  // Signe MOINS typographique (U+2212), pas le trait d'union du clavier : sur
  // une économie affichée en gros, le tiret court se lit comme une puce.
  return `${rounded < 0 ? "−" : ""}${units}${decimals ? `,${String(decimals).padStart(2, "0")}` : ""}${NBSP}€`;
}

/**
 * « À partir de 250 € » — le libellé d'un PLANCHER, composé et jamais recopié.
 *
 * Deux prestations se chiffrent ainsi (`IDENTITE_FROM_CENTS`,
 * `INSTALL_FROM_CENTS`), et elles s'affichent sur deux surfaces : la landing et
 * la page Offres. Quatre endroits, une seule formulation possible — écrire
 * « Dès 250 € » ici et « À partir de 250 € » là ferait douter que ce soit le
 * même prix.
 */
export const aPartirDe = (cents: number): string => `À partir de ${euros(cents)}`;

/**
 * LA FOURCHETTE EN UNE LIGNE — « 99, 159 ou 199 € par mois ».
 *
 * Elle existe pour la META DESCRIPTION de la vitrine
 * (`app/(marketing)/layout.tsx`), c'est-à-dire pour le texte que Google
 * affiche sous le lien et que les messageries collent dans leur aperçu.
 *
 * ET ELLE EST ICI POUR UNE RAISON PRÉCISE : la description vivait HORS de
 * `components/marketing/`, donc invisible pour qui corrige ce fichier. À la
 * révision du 21/08/2026 elle a continué d'annoncer l'ancienne grille dans le
 * résultat de recherche pendant que la page affichait la nouvelle — le seul
 * endroit du site où un prix périmé se lit sans même ouvrir la page.
 *
 * Un seul symbole € en fin d'énumération, comme on l'écrit à l'oral.
 */
const plainEuros = (cents: number): string => euros(cents).replace(`${NBSP}€`, "");

export const PRICE_RANGE = `${plainEuros(PLAN_MONTHLY_CENTS.essentiel)}, ${plainEuros(
  PLAN_MONTHLY_CENTS.complet,
)} ou ${plainEuros(PLAN_MONTHLY_CENTS.boost)}${NBSP}€ par mois`;

/**
 * LA RARETÉ SANS LE COMPTEUR.
 *
 * `FOUNDER_SEATS_TAKEN` valait 3 alors que nous n'avons AUCUN client signé :
 * c'était le seul énoncé de la page qu'un prospect pouvait prendre en flagrant
 * délit d'un coup de téléphone. Le décompte et ses pastilles sont supprimés —
 * constante, calcul et affichage. La politique, elle, est vraie et reste.
 */
export const FOUNDER_POLICY = "Les dix premiers restaurants gardent leur tarif à vie.";

/* ── Appels à l'action ───────────────────────────────────────── */

/**
 * DEUX LIBELLÉS POUR TOUTE LA PAGE, ET PAS UN DE PLUS.
 *
 * Elle en portait six (« Demander une démo », « Demander un devis »,
 * « Réserver ma démo », « Vérifier ces chiffres avec nous », « Explorer la
 * démo », « Contactez-nous ») pour deux destinations seulement. Six verbes
 * pour deux gestes, c'est six décisions demandées au lecteur là où il y en a
 * deux.
 *
 * `CTA_DEMO` est le seul qui reste distinct : il ne mène PAS au formulaire.
 * Ce n'est pas un appel commercial, c'est une commande de produit.
 */
export const CTA_CALLBACK = "Être rappelé";
export const CTA_DEMO = "Prendre une commande en démo";

/* ── Les onze sections ───────────────────────────────────────── */

export type SectionMeta = {
  /** Ancre réelle dans le DOM — toute entrée de navigation doit la viser. */
  id: string;
  /** Libellé court du sommaire (menu burger, encoche d'en-tête). */
  nav: string;
  /** Pastille au-dessus du titre. `null` = la section n'en porte pas. */
  badge: string | null;
  /** Le `h2` de la section, écrit ici et nulle part ailleurs. */
  title: string;
};

/**
 * L'ORDRE DE LA PAGE, ET C'EST UN ORDRE DE QUESTIONS.
 *
 * Est-ce que je suis au bon endroit ? est-ce que ça me parle ? est-ce que ça
 * existe ? comment mes clients commandent ? est-ce que ça marche dans MA
 * cuisine ? combien ? et par rapport à ce que je paie déjà ? si je dis oui,
 * il se passe quoi ? qu'est-ce que je risque ? à qui je donne mon numéro ?
 *
 * Chaque question est posée UNE fois. Une section qui redit le travail d'une
 * autre n'a pas sa place ici — les sections ne se répètent plus, elles se
 * citent (voir `SIM_CTA_NOTE` et `PILOTE_SIGNATURE`).
 */
export const SECTIONS: readonly SectionMeta[] = [
  { id: "hero", nav: "Accueil", badge: null, title: "On fait tourner votre restaurant. Pas l'inverse." },
  {
    id: "votre-service",
    nav: "Votre service",
    badge: "Comparatif",
    title: "Votre service aujourd'hui. Votre service lundi prochain.",
  },
  { id: "produit", nav: "Produit", badge: "Le produit", title: "Ne nous croyez pas sur parole. Prenez une commande." },
  // « Vos clients commandent chez vous. Pas chez eux. » désignait un adversaire
  // sans le nommer — « chez eux », c'est qui ? — et n'expliquait nulle part
  // l'avantage qu'il y a à commander chez le restaurateur. Une préférence
  // annoncée sans sa raison. La section dit maintenant ce qu'on FAIT.
  { id: "commander", nav: "Services", badge: "Nos services +", title: "Un logiciel ne suffit pas. On s'occupe du reste." },
  {
    id: "materiel",
    nav: "Matériel",
    badge: "Chez vous",
    // « Rien à racheter » ne répondait qu'à moitié : le restaurateur qui n'a pas
    // de tablette, ou qui ne veut pas s'en occuper, restait sans réponse.
    title: "Vous avez le matériel ? Parfait. Sinon, on s'en occupe.",
  },
  { id: "tarifs", nav: "Tarifs", badge: "Tarifs", title: "Trois prix, affichés. Zéro commission, toujours." },
  {
    id: "simulateur",
    nav: "Le calcul",
    badge: "Le calcul",
    // Le titre CITE le tarif de la formule la plus vendue, et il était recopié
    // à la main : à la révision de grille, la section qui compare nos prix à
    // ceux de l'organisation actuelle a continué d'annoncer un montant que la
    // section juste au-dessus démentait. Il se dérive maintenant.
    title: `${euros(PLAN_MONTHLY_CENTS.complet)} par mois. Et votre organisation actuelle, elle vous coûte combien ?`,
  },
  {
    id: "lancement",
    nav: "Lancement",
    badge: "Le lancement",
    // Le titre disait « On date ce qu'on livre. Jamais ce que vous gagnerez. » :
    // une précaution déguisée en promesse, qui parlait de nos scrupules au lieu
    // de répondre à la question posée — comment ça se passe ? Vite, et
    // accompagné. Les quatre jalons le disaient déjà ; le titre les contredisait.
    title: "On installe vite. Et on reste après.",
  },
  // « Vous avez des doutes. Ils sont légitimes. » installait le doute au lieu de
  // le lever. Un visiteur arrivé jusqu'ici n'a pas de doutes, il a des questions.
  { id: "faq", nav: "Questions", badge: "Questions", title: "Vos questions. Nos réponses." },
  {
    id: "histoire",
    nav: "Notre histoire",
    badge: "Notre histoire",
    // « Ce logiciel a un restaurant. Il s'appelle Class'Food. » mettait l'outil
    // au centre au moment précis où le lecteur cherche des gens. Ce qu'il veut
    // savoir avant de laisser son numéro, c'est à QUI il le laisse.
    title: "Un expert de la tech, un restaurateur, et le logiciel qui leur manquait.",
  },
  { id: "contact", nav: "Contact", badge: null, title: "Laissez-nous votre numéro. On rappelle sous 24 h." },
] as const;

/** Retrouve la pastille et le titre d'une section par son ancre. */
export function section(id: string): SectionMeta {
  const found = SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue : ${id}`);
  return found;
}

/* ── Navigation ──────────────────────────────────────────────── */

export type NavLink = { readonly href: string; readonly label: string };

/**
 * ═══ LE SITE N'EST PLUS UNE PAGE, DONC UNE ANCRE N'EST PLUS UNE ANCRE ═══
 *
 * Tant que la vitrine tenait sur `/`, `href="#tarifs"` marchait partout parce
 * qu'il n'y avait qu'un « partout ». Deux routes s'ajoutent — `/offres` et
 * `/blog` — et le même lien, écrit depuis un article, résout en
 * `/blog/mon-article#tarifs` : le navigateur cherche l'élément dans la page où
 * l'on est, ne le trouve pas, ET NE FAIT RIEN. Pas d'erreur, pas de 404, pas
 * une ligne de console. Le lien du menu devient un lien qui ne fait rien, et
 * personne ne le voit avant un prospect.
 *
 * Toute ancre de la landing s'écrit donc en chemin ABSOLU, et par cette
 * fonction. Depuis `/` le navigateur reconnaît une navigation de même document
 * et se contente de faire défiler (`scroll-behavior: smooth` s'applique,
 * `scroll-padding-top` aussi) ; depuis `/blog` il revient sur la landing et
 * atterrit à la bonne section. Un seul énoncé, les deux cas couverts.
 *
 * `section(id)` LÈVE si l'ancre n'existe plus dans `SECTIONS` : le jour où une
 * section est supprimée, le typecheck passe mais le rendu casse net au lieu de
 * livrer un menu silencieusement mort. C'est le comportement voulu — c'est
 * exactement ainsi qu'« Expertise → #pourquoi » a survécu des semaines au
 * composant qu'il désignait.
 */
export const ancre = (id: string): NavLink => ({ href: `/#${id}`, label: section(id).nav });

/** Le sommet de la landing — cible du logo, depuis n'importe quelle route. */
export const LANDING_TOP = "/#top";

/**
 * LES DEUX ROUTES QUI NE SONT PAS LA LANDING.
 *
 * La refonte a ramené la vitrine de dix-sept sections à onze : environ 1 200
 * mots de surface de référencement en moins. Ces deux pages les rendent, mais
 * en répondant à des recherches réelles au lieu de répéter la vitrine — d'où
 * des ROUTES et pas des sections de plus.
 *
 * Elles vivent dans le groupe `(marketing)`, donc sous le conteneur `.mk` et
 * ses jetons de charte : `app/(marketing)/offres/page.tsx` et
 * `app/(marketing)/blog/…`. Le chemin public ne porte PAS le nom du groupe.
 */
export const NAV_PAGES: readonly NavLink[] = [
  { href: "/offres", label: "Offres" },
  { href: "/blog", label: "Blog" },
];

/**
 * L'encoche s'ouvre en deux groupes SYMÉTRIQUES autour du logo — `SiteHeader`
 * mesure le plus large des deux et le double. Trois et trois : un groupe de
 * deux face à un groupe de quatre ouvrirait une encoche taillée pour quatre et
 * laisserait un blanc à gauche.
 *
 * ═══ CE QUI SÉPARE LES DEUX GROUPES : CE QUE LE CLIC FAIT ═══
 *
 * L'encoche mélangeait les deux natures — « Produit » (une ancre), puis
 * « Offres » et « Blog » (deux routes), puis « Tarifs » et « Questions » (des
 * ancres à nouveau). Les deux routes étaient donc PLANTÉES AU MILIEU de la
 * séquence d'ancres. Le visiteur clique « Produit », la page défile ; il clique
 * « Offres » juste à côté, la page CHANGE ; il clique « Tarifs », la page
 * défile de nouveau. Rien ne l'a prévenu, et c'est ce qui désoriente.
 *
 * Le partage porte maintenant cette distinction, et rien d'autre :
 *   · À GAUCHE, LES ANCRES DE CETTE PAGE, dans l'ordre du défilement. La barre
 *     devient un sommaire — ce qui est à gauche dans l'encoche est au-dessus
 *     dans le document. Une navigation prévisible sans avoir à l'apprendre.
 *   · À DROITE, CE QUI QUITTE LA PAGE, puis l'action. « Contact » ferme la
 *     barre parce que c'est le geste qu'on veut, pas une destination parmi
 *     d'autres.
 *
 * « Questions » (`#faq`) sort de l'encoche. Personne, en haut d'une page, ne
 * saute à la FAQ : elle se rencontre dans le parcours. Un en-tête qui dépense
 * un créneau sur six pour une destination que personne ne vise depuis le haut
 * gaspille son créneau le plus cher. Elle reste dans le sommaire du burger et
 * dans le pied de page.
 */
export const NAV_LEFT: readonly NavLink[] = [ancre("produit"), ancre("commander"), ancre("tarifs")];

export const NAV_RIGHT: readonly NavLink[] = [...NAV_PAGES, ancre("contact")];

/**
 * LE SOMMAIRE DU MENU BURGER — pas la même chose que l'encoche.
 *
 * La barre collante disparaît ; sur téléphone, le burger devient la SEULE
 * navigation du site. Il doit donc être un sommaire complet, pas un raccourci
 * de cinq entrées. Le hero est exclu : on y est déjà.
 *
 * Les deux routes sont tenues à part (`NAV_PAGES`, rendues sous un filet) :
 * fondues dans la liste, « Offres » et « Blog » se lisaient comme deux
 * sections de la landing, et un lecteur qui les prend pour des ancres ne
 * comprend pas pourquoi la page change.
 */
export const NAV_MOBILE: readonly NavLink[] = SECTIONS.filter((s) => s.id !== "hero").map((s) => ancre(s.id));

/* ── Réseaux sociaux ─────────────────────────────────────────── */

export type Reseau = {
  readonly id: "instagram" | "tiktok" | "facebook" | "linkedin";
  /** Le libellé accessible — « Snack Manager sur Instagram ». */
  readonly nom: string;
};

/**
 * ═══ UN RÉSEAU SANS ADRESSE NE S'AFFICHE PAS ═══
 *
 * Deux façons de se tromper, et la seconde est la pire : une icône sans lien
 * qu'on clique et qui ne fait rien ; ou une icône qui mène à un compte créé la
 * veille, vide, que le prospect découvre à l'instant précis où il cherchait à
 * se rassurer sur notre sérieux. Un profil à zéro publication en dit plus long
 * qu'une absence de profil.
 *
 * La règle est donc que L'URL EST LA CONDITION D'AFFICHAGE, et elle est tenue
 * en deux endroits : l'API n'enregistre jamais de chaîne vide (une saisie vidée
 * devient `null`), et `lireReseaux` (lib/reseaux.ts) revérifie à la lecture.
 *
 * ═══ CETTE TABLE NE PORTE PLUS D'ADRESSES ═══
 *
 * Elle en portait, à `null`, avec un commentaire expliquant comment en glisser
 * une le temps d'un essai « puis REMETTRE null » — c'est-à-dire une procédure
 * manuelle dont l'oubli publiait une adresse d'essai sans que rien ne le
 * signale. Les adresses vivent maintenant en base et se saisissent dans
 * `/sm/reseaux` ; ce qui reste ici est ce qui n'a rien à faire dans une base :
 * le libellé accessible et L'ORDRE. Ce sont des décisions éditoriales.
 *
 * L'ordre est celui de leur utilité pour un éditeur qui vise des
 * restaurateurs : la cuisine et le service se montrent (Instagram, TikTok), le
 * commerce de proximité se fait sur Facebook, et LinkedIn ne sert qu'à ceux
 * qui vérifient qui nous sommes — il est donc dernier, pas absent.
 */
export const RESEAUX: readonly Reseau[] = [
  { id: "instagram", nom: "Instagram" },
  { id: "tiktok", nom: "TikTok" },
  { id: "facebook", nom: "Facebook" },
  { id: "linkedin", nom: "LinkedIn" },
];

/**
 * Un réseau dont l'adresse est renseignée — le seul type qu'on sait rendre.
 *
 * `RESEAUX_PUBLIÉS` a disparu avec la table en dur : c'était un filtre calculé
 * à la portée du module, donc à la COMPILATION, et il ne pouvait par
 * construction jamais voir une adresse saisie au back-office. `lireReseaux()`
 * le remplace.
 */
export type ReseauPublié = Reseau & { readonly url: string };

/* ── Pied de page ────────────────────────────────────────────── */

export type FooterColumn = { readonly title: string; readonly links: readonly NavLink[] };

/**
 * LE PIED DE PAGE EST DEVENU LA NAVIGATION SECONDAIRE DU SITE.
 *
 * Tant qu'il n'y avait qu'une page, il pouvait se contenter de recopier
 * l'encoche — et il en dérivait ses liens, ce qui était la bonne idée pour la
 * mauvaise raison : ça évitait les ancres mortes, mais ça condamnait le pied
 * de page à ne jamais montrer plus que le menu. Or l'encoche ne peut pas
 * porter sept entrées, et le pied de page, lui, le peut.
 *
 * Il porte donc ce que l'encoche a dû laisser tomber : la section « Services »
 * évincée du menu, et les deux routes que la landing n'a aucune raison
 * d'annoncer dans son corps.
 *
 * Toutes les ancres passent par `ancre()`, qui les résout contre `SECTIONS` :
 * une section supprimée fait tomber le rendu au lieu de laisser un lien mort.
 */
export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    title: "La plateforme",
    links: [ancre("produit"), ancre("commander"), ancre("materiel"), ancre("tarifs")],
  },
  {
    title: "En savoir plus",
    // Le libellé s'allonge (« Questions » → « Questions fréquentes ») mais
    // l'adresse reste dérivée : on ne recopie jamais un `/#`.
    links: [...NAV_PAGES, { ...ancre("faq"), label: "Questions fréquentes" }],
  },
  {
    title: "Nous joindre",
    links: [
      { ...ancre("contact"), label: CTA_CALLBACK },
      { href: `mailto:${CONTACT_EMAIL}`, label: CONTACT_EMAIL },
    ],
  },
];

/**
 * LA MENTION D'ÉDITEUR, EN TEXTE ET PAS EN LIEN.
 *
 * Un pied de page français appelle « Mentions légales » et « Politique de
 * confidentialité » ; ces deux pages n'existent pas. Les annoncer maintenant
 * reviendrait à refaire, en bas de page, exactement la faute que la table des
 * réseaux existe pour empêcher : promettre une destination qu'on n'a pas. On
 * dit donc en clair ce qu'on peut dire — qui édite, où l'on écrit — et le lien
 * viendra avec la page, pas avant.
 */
export const FOOTER_EDITEUR = `Snack Manager — édité en France. Une question sur vos données : ${CONTACT_EMAIL}.`;

/* ── 1. Hero — captures réelles des applications ─────────────── */

export type Shot = { src: string; alt: string; portrait?: boolean };

/** Deck 3D du hero : uniquement des captures paysage. */
export const HERO_SHOTS: Shot[] = [
  { src: "/shots/backoffice.png", alt: "Back-office Snack Manager : chiffre d'affaires du jour et commandes en direct" },
  { src: "/shots/pos.png", alt: "Caisse Snack Manager sur tablette, en cours de prise de commande" },
  { src: "/shots/kds.png", alt: "App cuisine Snack Manager : colonnes Nouveau, En préparation, Prêt" },
  // `menu.png` MONTRE LE BACK-OFFICE, et son texte alternatif annonçait « Commande
  // en ligne » : le deck représentait donc l'application que les CLIENTS du
  // restaurateur utilisent par une page de gestion, sur un écran d'ordinateur.
  // Le libellé dit maintenant ce que l'image montre.
  { src: "/shots/menu.png", alt: "Back-office Snack Manager : carte et prix, disponibilités en un geste" },
  // Et la vraie commande en ligne entre dans le deck, en PORTRAIT — c'est le
  // seul appareil de la rangée que le client du restaurateur tient en main.
  {
    src: "/shots/commande.png",
    alt: "Commande en ligne Snack Manager sur téléphone : carte du restaurant et click and collect",
    portrait: true,
  },
  { src: "/shots/board.png", alt: "Écran d'appel client Snack Manager : numéros prêts au retrait" },
];

/* ── 2. Votre service — le miroir ────────────────────────────── */

/**
 * SIX LIGNES DE CHAQUE CÔTÉ, ET ELLES SE RÉPONDENT UNE À UNE.
 *
 * C'est le SEUL endroit de la page où la douleur est écrite. Plus jamais
 * ailleurs : le catalogue des douleurs était rouvert par Vignettes, CaseStudy,
 * le premier panneau de Process et la citation du fondateur — cinq fois la
 * même journée décrite au restaurateur, qui la connaît mieux que nous.
 *
 * Le vocabulaire est celui d'un lecteur AU DEUXIÈME ÉCRAN, qui ne connaît pas
 * encore le produit. « Menus cadrés, totaux automatiques, ticket + sticker
 * sac » était un récapitulatif écrit pour quelqu'un qui avait déjà tout lu.
 *
 * La sixième ligne de gauche est la douleur numéro un d'un restaurateur en
 * 2026, et elle manquait entièrement. Sa réponse en face est le meilleur
 * argument de la page (voir `SERVICES[0]`).
 */
export const VS_WITHOUT = [
  "Trois outils qui ne se parlent pas, et vous au milieu",
  "Les commandes au stylo, les totaux calculés de tête",
  "Des jours de formation à chaque nouvelle recrue",
  // Sans outil, la masse salariale est CONSTATÉE, jamais décidée.
  "La masse salariale, vous la découvrez en fin de mois",
  "Un site qui ne prend pas les commandes",
  "Jusqu'à 30 % prélevés sur chaque commande livrée — et le client reste le leur",
] as const;

export const VS_WITH = [
  "Une seule plateforme — caisse, cuisine, back-office, commande en ligne",
  "La caisse calcule, imprime le ticket cuisine et le sticker du sac",
  "Une heure pour qu'une nouvelle recrue tienne la caisse",
  "Le planning affiche ce que la semaine va coûter avant que vous validiez",
  "Votre page de commande en ligne, à vos couleurs, sur votre nom de domaine",
  "Votre lien de commande sur votre fiche Google, marqué « préféré par l'établissement »",
] as const;

/* ── 3. Produit — le catalogue, en légende sous chaque cadre ──── */

export type CatalogueColumn = {
  name: string;
  device: string;
  /** `demo` pointe vers l'index de la scène 3D (`DEMO_APPS`). */
  demo: number;
  items: { pre?: string; strong?: string; post?: string }[];
};

/**
 * CINQ LIGNES PAR COLONNE, ET C'EST LE CHANGEMENT DE MÉTIER DE CE TABLEAU.
 *
 * Il était une SECTION posée AU-DESSUS de sa preuve : un inventaire avant la
 * démonstration est une plaquette. Il devient la LÉGENDE sous le cadre de
 * l'application correspondante — le même inventaire, mais on peut vérifier
 * chaque ligne au doigt dans les trente secondes qui suivent.
 *
 * D'où la coupe de sept lignes à cinq : on ne garde que ce qui se VÉRIFIE au
 * clic. Deux idées rescapées de Platform y sont versées, faute d'exister
 * ailleurs : la prise de commande par téléphone (colonne Caisse) et la
 * fidélité points/tampons (colonne Commande en ligne).
 *
 * La grille est à QUATRE colonnes en dur et `demo:` pointe un index de
 * `DEMO_APPS` : on ne réordonne pas sans casser le lien vers la scène.
 */
export const CATALOGUE: CatalogueColumn[] = [
  {
    name: "Caisse (POS)",
    device: "Tablette, au comptoir",
    demo: 0,
    items: [
      { strong: "Sur place, à emporter, téléphone", post: " — même écran" },
      { pre: "Tacos sur-mesure, passage en menu (+2,50 €) en un tap" },
      { pre: "Totaux, rendu monnaie, CB / espèces / au retrait" },
      { strong: "Ticket cuisine + sticker sac", post: " imprimés" },
      { pre: "Appairage par code à six caractères, révocable" },
    ],
  },
  {
    name: "Cuisine (KDS)",
    device: "Mural en cuisine, ou tablette",
    demo: 1,
    items: [
      { pre: "Colonnes ", strong: "Nouveau → En prépa → Prêt" },
      { pre: "« À lancer » agrégé : 3 frites, 2 tacos… en un coup d'œil" },
      { pre: "Minuteur couleur par commande, alerte sonore" },
      { pre: "Numéro de retrait pour appeler le client" },
      { strong: "Mode hors-ligne", post: " avec resynchronisation" },
    ],
  },
  {
    name: "Commande en ligne",
    device: "Web, mobile first",
    demo: 2,
    items: [
      { strong: "Click & collect", post: " avec créneaux de retrait" },
      { pre: "Paiement en ligne ou au retrait" },
      { pre: "Configurateur identique à la caisse — zéro surprise" },
      { pre: "Codes promo, ", strong: "fidélité points & tampons" },
      { strong: "À vos couleurs", post: ", sur votre nom de domaine" },
    ],
  },
  {
    name: "Back-office",
    device: "Web, côté gérant — 14 écrans",
    demo: 3,
    items: [
      { strong: "CA, commandes et stats", post: " en direct, exports CSV" },
      { pre: "Menu & prix en direct, ruptures en un tap" },
      // La ligne qui vaut la colonne : le planning fait DÉCIDER une dépense
      // au lieu de la constater. Le coût bouge à chaque service posé.
      { pre: "Planning : ", strong: "le coût de la semaine bouge pendant que vous la posez" },
      { strong: "Ingrédients & stocks", post: " : seuils, ruptures, pertes, inventaires" },
      { pre: "Fournisseurs, ", strong: "coût matière et marge par produit" },
    ],
  },
];

/* ── 3. Produit — la scène de démonstration ──────────────────── */

/**
 * Châssis dans lequel l'application est présentée. C'est l'appareil RÉEL du
 * terrain, pas une préférence graphique : une caisse se tient sur une tablette
 * posée en paysage au comptoir, la commande client se prend au téléphone, le
 * back-office vit sur un écran d'ordinateur, et l'écran cuisine est un moniteur
 * ACCROCHÉ AU MUR au-dessus du piano.
 *
 * `wall` n'est pas une coquetterie : un mural 24 pouces est en 16/9 quand une
 * tablette est en 16/10. Tant que la cuisine partageait le châssis `tablet`,
 * elle héritait de son rapport — donc d'une affiche rognée et d'une iframe qui
 * ne pouvait pas recevoir 1920 × 1080 sans bande noire.
 */
export type DemoDevice = "tablet" | "phone" | "wide" | "wall";

/**
 * ═══ LA RÉSOLUTION LOGIQUE DE CHAQUE APPAREIL — LA SOURCE UNIQUE ═══
 *
 * C'est le nombre de pixels CSS que l'application EMBARQUÉE croit avoir. Rien
 * à voir avec la place qu'elle occupe sur la page : le cadre l'affiche en
 * réduction (voir `DeviceFrame`), exactement comme on regarde un écran de loin.
 *
 * POURQUOI CE MODULE EST NÉCESSAIRE. Sans lui, l'iframe reçoit la taille du
 * cadre dessiné — 844 px pour la tablette, 856 pour l'écran large — et
 * l'application se met en page pour un petit écran :
 *
 *   · la cuisine, sous les 900 px de `TABS_MAX_WIDTH` (apps/kds/src/config.ts),
 *     bascule en mode COMPACT : une seule liste, des onglets par statut, et le
 *     panneau « À lancer » évaporé. C'est le défaut qui a déclenché ce
 *     chantier — le visiteur ne voyait pas le produit qu'on lui vend ;
 *   · le back-office sous ~1150 px replie sa rangée de cartes (« Prévisions du
 *     service » passe sous « Objectif du jour ») : la mise en page d'un petit
 *     portable, pas celle de l'ordinateur du gérant.
 *
 * CHAQUE VALEUR EST CELLE D'UN APPAREIL RÉEL, ET CELLE DE SON AFFICHE.
 * Les deux ne peuvent pas diverger : `scripts/capture-shots.mjs` photographie
 * chaque surface À CES DIMENSIONS. Le cadre porte donc le rapport exact de la
 * capture (aucun rognage) ET celui de l'application (aucune bande noire), et
 * le passage de l'affiche à la démo au clic ne fait bouger aucun pixel.
 * Changer un nombre ici, c'est recapturer l'affiche correspondante.
 *
 *   · tablet 1280 × 800 — la tablette 10 pouces du comptoir, nommée
 *     « la référence » par apps/kds/src/config.ts ;
 *   · wall   1920 × 1080 — le mural 24 pouces de la cuisine. Au-dessus de
 *     `ALLDAY_MIN_SCREEN` (1240) : trois colonnes ET le panneau « À lancer ».
 *     Petit côté 1080 → échelle typographique 1,28 dans le KDS, celle qui rend
 *     l'écran lisible depuis la friteuse ;
 *   · wide   1440 × 900 — l'ordinateur du gérant, 16/10 comme son châssis ;
 *   · phone  390 × 844 — un téléphone courant, celui du client dans la file.
 */
export const DEVICE_SCREEN: Record<DemoDevice, { w: number; h: number }> = {
  tablet: { w: 1280, h: 800 },
  wall: { w: 1920, h: 1080 },
  wide: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};

/**
 * Origines des applications DE TERRAIN embarquées dans la vitrine.
 *
 * ═══ ELLES SUIVENT L'ENVIRONNEMENT, ET C'EST UNE LEÇON PAYÉE DEUX FOIS ═══
 *
 * Elles ont été codées en dur dans les deux sens en une seule journée. D'abord
 * sur STAGING, ce qui faisait embarquer des déploiements de test dans la
 * vitrine de production. Puis sur PRODUCTION pour corriger ce défaut — et la
 * vitrine de staging s'est mise à embarquer la production, ce qui est pire :
 * les compilations de production sont en retard sur le mode démonstration, si
 * bien que le visiteur tombait sur L'ÉCRAN D'APPAIRAGE au lieu d'une caisse.
 * Constaté en comptant les marqueurs de démonstration dans les paquets servis :
 * un côté production, cinq côté staging.
 *
 * Une adresse figée est fausse dans un environnement sur deux. Chaque
 * déploiement porte donc les siennes, et le repli est la PRODUCTION — parce
 * qu'un environnement mal configuré doit dégrader vers le public et jamais vers
 * un déploiement interne.
 *
 * Corollaire à assumer côté exploitation : ces démonstrations sont un SERVICE
 * à surveiller, pas une image qu'on dépose et qu'on oublie. Et un déploiement
 * de la vitrine sans déploiement correspondant du POS et du KDS laisse un cadre
 * qui ne joue plus la démonstration.
 */
export const DEMO_ORIGINS = {
  pos: process.env.NEXT_PUBLIC_DEMO_POS_URL ?? "https://pos-production-a9d8.up.railway.app",
  kds: process.env.NEXT_PUBLIC_DEMO_KDS_URL ?? "https://kds-production-8991.up.railway.app",
} as const;

/**
 * Le seul déclencheur du mode démonstration, côté applications de terrain
 * (`packages/client-core/src/demo/mode.ts`) : `?demo=1`, et rien d'autre.
 *
 * Ce mode ne touche AUCUNE base : la carte, le service en cours et les
 * commandes prises par le visiteur vivent dans son propre navigateur. Deux
 * visiteurs ne se croisent jamais, aucun faux restaurant n'apparaît dans le
 * CRM, et rien ne pollue la médiane réseau qui alimente notre conseil chiffré.
 */
export const DEMO_QUERY = "?demo=1";

/** URL complète à charger dans le cadre (ou à ouvrir dans un onglet). */
export function demoHref(origin: string): string {
  return `${origin}/${DEMO_QUERY}`;
}

/**
 * Les deux démonstrations servies par CE site — même origine que la vitrine.
 *
 * Ces adresses ne sont pas devinées, elles sont RECOPIÉES de la bascule que
 * chaque surface expose ; toucher l'une sans l'autre casserait la vitrine.
 *
 *   · back-office  → `apps/web/src/lib/demo/mode.ts`
 *     `DEMO_PARAM=demo`, `DEMO_VALUE=1`, et une borne de chemin `/admin` :
 *     le paramètre seul ne suffit pas, l'adresse doit être sous `/admin`.
 *     On vise `/admin/dashboard` et non `/admin` : la page d'index fait une
 *     redirection serveur vers `/admin/menu` qui perdrait la requête — donc
 *     le paramètre, donc la démonstration, remplacée par l'écran de connexion.
 *
 *   · commande en ligne → `apps/web/src/components/order/demo/mode.ts`
 *     deux verrous : `?demo=1` ET le slug réservé `demo`. Sans les deux,
 *     `/r/demo` répond 404 comme n'importe quel restaurant inconnu.
 */
export const DEMO_PATHS = {
  bo: `/admin/dashboard${DEMO_QUERY}`,
  order: `/r/demo${DEMO_QUERY}`,
} as const;

/**
 * Ce qu'il faut pour rendre une application MANIPULABLE depuis la vitrine.
 *
 * Absent = l'application n'a pas (encore) de mode démonstration : on garde
 * l'affiche seule plutôt que d'embarquer un écran d'appairage ou un écran de
 * connexion, qui donneraient l'impression d'un produit fermé.
 */
export type DemoLive = {
  /**
   * Adresse complète à charger, paramètre de démonstration compris.
   *
   * Deux formes cohabitent, et la différence n'est pas cosmétique : une URL
   * absolue (caisse, cuisine — déployées à part) ou un chemin de CE site
   * (back-office, commande en ligne). Une page de même origine embarquée avec
   * `allow-same-origin` retrouve le droit de lire le DOM de la vitrine ; la
   * conséquence est arbitrée et expliquée là où l'iframe est écrite, dans
   * `AppsShowcase`.
   */
  href: string;
  /** Bouton posé sur l'affiche, sur grand écran. Monte la démo dans le cadre. */
  cta: string;
  /**
   * Ouverture dans un onglet, À TOUTE LARGEUR — plus un repli de petit écran.
   *
   * L'application embarquée est réduite pour tenir dans le cadre (1920 px de
   * cuisine dans ~1130 px), donc son texte est plus petit que sur l'appareil
   * réel. Ce lien est la seule façon de la lire à sa taille : il est proposé
   * dès le premier regard, à côté de `cta`, et de nouveau sous le cadre
   * pendant que la démo tourne.
   *
   * Le libellé ne nomme donc plus l'application (« Ouvrir la caisse en plein
   * écran ») : côte à côte avec « Essayer la caisse », il la nommait deux fois
   * et débordait de la ligne. En dessous de 810 px, où il reste seul, la
   * pastille active au-dessus du cadre dit déjà de quelle app il s'agit.
   */
  ctaOut: string;
  /**
   * Par où commencer — UNE phrase, propre à l'application.
   *
   * Elle est affichée sous le cadre, affiche comprise : avant le clic elle
   * annonce ce qu'on va pouvoir faire, après le clic elle dit par où
   * commencer. « Touchez un produit » n'a aucun sens devant un back-office ;
   * chaque application a donc la sienne.
   */
  hint: string;
  /** `title` de l'iframe — lu tel quel par les lecteurs d'écran. */
  title: string;
};

export type DemoApp = {
  id: string;
  label: string;
  device: DemoDevice;
  shot: Shot;
  lead: string;
  body: string;
  live?: DemoLive;
};

/**
 * L'ORDRE EST UN CHOIX, ET IL COMMENCE PAR LA CAISSE.
 *
 * La scène s'ouvre sur `DEMO_APPS[0]`. Le back-office y était : le visiteur
 * tombait sur un écran de gestion, sans bouton « Essayer » sous les yeux
 * puisque la démonstration du back-office n'existait pas encore — l'effet
 * était perdu au premier regard. La caisse est l'écran auquel un restaurateur
 * s'identifie immédiatement : c'est celui qu'il a devant lui toute la journée.
 *
 * L'ordre suit ensuite le trajet d'une commande — caisse, cuisine, commande
 * client — et finit par le poste du gérant. C'est aussi l'ordre des colonnes
 * de `CATALOGUE` ci-dessus ; ses `demo:` pointent ces index.
 */
export const DEMO_APPS: DemoApp[] = [
  {
    id: "pos",
    label: "Caisse (POS)",
    device: "tablet",
    shot: { src: "/shots/pos.png", alt: "Caisse : catalogue, configurateur produit et ticket en cours" },
    lead: "Caisse.",
    body: " Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés — prise en main en une heure, même pour une nouvelle recrue.",
    live: {
      href: demoHref(DEMO_ORIGINS.pos),
      cta: "Essayer la caisse",
      ctaOut: "Ouvrir en plein écran",
      hint: "Touchez un produit pour composer une commande, puis encaissez.",
      title: "Caisse Snack Manager en démonstration",
    },
  },
  {
    id: "kds",
    label: "Cuisine (KDS)",
    // Un mural, pas une tablette : 16/9, et 1920 × 1080 dans le cadre. Voir
    // `DEVICE_SCREEN` — en dessous de 900 px l'app bascule en mode onglets et
    // le panneau « À lancer » disparaît, c'est-à-dire tout ce qu'on montre ici.
    device: "wall",
    shot: { src: "/shots/kds.png", alt: "App cuisine : colonnes Nouveau, En préparation, Prêt avec minuteurs" },
    lead: "Cuisine.",
    body: " Les commandes arrivent seules, « 3 frites à lancer » en un coup d'œil, statuts Nouveau → En prépa → Prêt, minuteurs et alerte sonore.",
    live: {
      href: demoHref(DEMO_ORIGINS.kds),
      cta: "Essayer l'écran cuisine",
      ctaOut: "Ouvrir en plein écran",
      hint: "Ouvrez « Nouveau » et touchez « Accepter » : le ticket part en préparation.",
      title: "Écran cuisine Snack Manager en démonstration",
    },
  },
  {
    id: "order",
    label: "Commande client",
    device: "phone",
    shot: { src: "/shots/commande.png", alt: "Commande en ligne sur mobile : carte du restaurant et panier", portrait: true },
    lead: "Commande en ligne.",
    body: " Le client commande et paie — le ticket file droit en cuisine, déjà encaissé. La caisse ne fait que remettre le sac.",
    live: {
      href: DEMO_PATHS.order,
      cta: "Essayer la commande en ligne",
      ctaOut: "Ouvrir en plein écran",
      hint: "Composez un tacos, ajoutez-le au panier, choisissez votre créneau.",
      title: "Commande en ligne Snack Manager en démonstration",
    },
  },
  {
    id: "bo",
    label: "Back-office",
    device: "wide",
    shot: { src: "/shots/backoffice.png", alt: "Back-office : CA du jour, commandes en direct, prévisions du service" },
    lead: "Back-office gérant.",
    body: " Quatorze écrans : CA du jour, menu & prix en direct, planning dont le coût s'affiche avant que vous validiez, stocks et coût matière, factures.",
    live: {
      href: DEMO_PATHS.bo,
      cta: "Essayer le back-office",
      ctaOut: "Ouvrir en plein écran",
      // L'enjeu du back-office n'est pas un geste, c'est l'ÉTENDUE : on invite
      // donc explicitement à ouvrir les écrans les uns après les autres.
      hint: "Promenez-vous dans le menu de gauche : tout est là, écran par écran.",
      title: "Back-office Snack Manager en démonstration",
    },
  },
];

/**
 * L'APPLICATION QUI RESTE MANIPULABLE SOUS 810 px, ET C'EST LA SEULE.
 *
 * Le hero promet un geste (« Prendre une commande en démo ») ; sous le seuil
 * étroit, `AppsShowcase` démontait TOUTE iframe et la promesse tombait sur
 * l'appareil que le prospect tient dans la main. Or la commande client est
 * dessinée pour 390 px — et c'est en plus la seule des quatre que les clients
 * du restaurateur utiliseront vraiment.
 *
 * On ouvre donc la scène sur elle en dessous du seuil, et on l'épargne du
 * démontage. Les trois autres gardent l'affiche et « Ouvrir en plein écran » :
 * une caisse de 1280 px réduite dans 340 px n'est pas une démonstration, c'est
 * une vignette illisible.
 */
export const DEMO_MOBILE_ID = "order";

/**
 * LE REPLI, ET IL N'EST PAS NÉGOCIABLE.
 *
 * Si le cadre ne charge pas — origine tombée, réseau coupé, iframe bloquée par
 * le navigateur — on affiche la capture de `public/shots` avec CETTE mention.
 * Jamais un cadre blanc : un cadre blanc, sur la section dont dépend toute la
 * page, se lit comme un produit qui n'existe pas.
 */
export const DEMO_FALLBACK = "La démonstration ne répond pas — voici l'écran réel.";

/**
 * LA SIGNATURE DU PILOTE, EN PIED DE DÉMONSTRATION — une ligne, pas une
 * section.
 *
 * Founder est en dixième position sur onze : sans elle, le visiteur défile
 * cinq mille pixels sans une preuve d'existence. L'EXISTENCE du pilote est
 * donc affirmée ici, au troisième écran ; sa VOIX reste en section 10, à
 * l'endroit où l'on se demande à qui on donne son numéro.
 */
export const PILOTE_SIGNATURE =
  "Ce que vous venez de manipuler tourne à Class'Food, Perriers-sur-Andelle, midi et soir, 7 j/7.";

/* ── 4. Nos services + — ce qu'on fait, en plus du logiciel ──── */

export type Service = {
  id: string;
  title: string;
  /** L'accroche, en une phrase. Ce que le service PRODUIT, pas ce qu'il est. */
  lead: string;
  /** Le détail, deux ou trois phrases. C'est ici que l'avantage se chiffre. */
  line: string;
  /**
   * Le montant, seul. « 79 € / mois », « À partir de 250 € ». Jamais vide, et
   * jamais saisi : il se compose par `euros()` ou `aPartirDe()` depuis les
   * constantes en centimes du haut de ce fichier.
   */
  price: string;
  /**
   * La condition, sous le montant : mise en service, sur devis, formule qui
   * l'inclut. Elle a sa ligne parce qu'un prix suivi de ses conditions sur la
   * même ligne cesse d'être lisible d'un coup d'œil — or c'est tout ce qu'on
   * lui demande.
   */
  priceNote?: string;
};

/**
 * LA SECTION NE PARLE PLUS DE CANAUX, ELLE PARLE DE CE QU'ON FAIT.
 *
 * Elle s'intitulait « Vos clients commandent chez vous. Pas chez eux. » et le
 * fondateur a mis le doigt sur le défaut : « chez eux », c'est qui ? Le titre
 * désignait un adversaire sans le nommer, et surtout il n'expliquait NULLE PART
 * l'avantage qu'il y a à commander chez le restaurateur plutôt que sur Uber
 * Eats. Il annonçait une préférence sans donner sa raison.
 *
 * Trois services, et chacun dit ce qu'il produit. La fiche Google reste en
 * tête : c'est le meilleur argument de la page, et il est vérifiable.
 *
 * ═══ ON NE SE BAT PAS CONTRE UBER EATS, ON SE PLACE À CÔTÉ ═══
 *
 * Première rédaction : « les plateformes posent leur lien sans vous demander
 * votre avis », « on demande le retrait des autres ». Le fondateur a coupé
 * court, et il a raison sur le fond commercial : les plateformes sont un ATOUT
 * pour le chiffre d'affaires du restaurateur, elles lui apportent des clients
 * qu'il n'aurait pas eus et elles portent les sacs. Un prospect qui en vit
 * n'écoute pas quelqu'un qui commence par les attaquer — il entend qu'on lui
 * demande de renoncer à du volume.
 *
 * La division du travail est plus juste ET plus vendeuse : LES PLATEFORMES
 * ACQUIÈRENT, LE CANAL DIRECT FIDÉLISE. L'habitué qui commande en direct paie
 * le prix de la carte, celui qu'on n'a pas eu à gonfler pour absorber la
 * commission et les frais de service ; ses points de fidélité sont dans la
 * page ; son numéro appartient au restaurateur. On n'enlève rien, on ajoute.
 *
 * VÉRIFIÉ CONTRE LA DOCUMENTATION GOOGLE (support.google.com/business/
 * answer/10842217, consultée le 20/08/2026) : un établissement peut ajouter ses
 * propres liens de commande et les marquer comme préférés. La fiche porte donc
 * les DEUX — celui des plateformes et le sien, préféré. On ne prête aucun délai
 * à Google, qui n'en publie pas.
 *
 * LES PRIX SONT ÉCRITS ICI, pas renvoyés à un devis. Un service dont le prix se
 * demande est un service qu'on ne demande pas.
 */
export const SERVICES: readonly Service[] = [
  {
    id: "google",
    title: "Votre visibilité sur Google",
    lead: "Vos clients vous trouvent sur Google. Offrez-leur aussi le choix de commander en direct.",
    line: "On ajoute votre lien de commande sur votre fiche, à côté de ceux des plateformes et marqué « préféré par l'établissement ». Uber Eats et Deliveroo continuent de vous apporter des clients que vous n'auriez pas eus, et de porter les sacs. Votre page, elle, retient ceux qui reviennent.",
    price: "Compris dans la mise en route",
  },
  {
    id: "identite",
    title: "Votre identité visuelle",
    lead: "Une enseigne qui a l'air de ce qu'elle vaut.",
    line: "Logo, palette, carte remise en forme et photographiée : on reprend votre identité et on la pose partout — page de commande, écrans de salle, sacs, réseaux. Beaucoup de très bons snacks se vendent moins bien que leur cuisine, et ça se corrige.",
    price: aPartirDe(IDENTITE_FROM_CENTS),
    priceNote: "Sur devis, une fois",
  },
  {
    id: "commande",
    title: "Commande en ligne & fidélité",
    lead: "Le click and collect et la carte de fidélité, dans la même page.",
    line: "Un habitué qui commande chez vous en direct paie le prix affiché en salle — pas celui qu'il faut gonfler pour absorber 30 % de commission et des frais de service. Ses points se cumulent tout seuls à chaque commande, et le client est le vôtre : son numéro, son historique, ses habitudes. En ligne dès l'ouverture du compte, à vos couleurs, sur votre nom de domaine si vous en avez un — ou branchée sur le site que vous avez déjà, avec une balise que nous collons pour vous.",
    // Le module est vendu deux fois sur la page — ici, et sous la grille
    // (`MODULE_ADDON`). Les deux montants descendent des mêmes constantes :
    // c'est le seul service dont le prix est répété, donc le seul qui pouvait
    // se contredire d'une section à l'autre.
    price: `${euros(MODULE_MONTHLY_CENTS)} / mois`,
    priceNote: `+ ${euros(MODULE_SETUP_CENTS)} de mise en service · les deux compris dans Boost`,
  },
];

/**
 * LA CLAUSE D'HONNÊTETÉ, EN PIED DE SECTION.
 *
 * Le tunnel va du panier au créneau de retrait (`components/order/Checkout`) :
 * c'est du click & collect, et NOUS NE FOURNISSONS AUCUN LIVREUR. On le dit
 * ici, à l'endroit exact où le lecteur vient de comprendre qu'il peut reprendre
 * son volume aux plateformes — c'est là et nulle part ailleurs qu'il se demande
 * qui va porter les sacs.
 *
 * Ce n'est pas une pastille de fonctionnalité : une pastille se lit comme
 * quelque chose qu'on fournit.
 */
export const DIRECT_DELIVERY = {
  lead: "Vous livrez ?",
  line: "Vous continuez comme aujourd'hui — vos tournées, vos horaires. Personne ne s'intercale entre votre cuisine et votre client.",
} as const;

/**
 * LA PHOTOGRAPHIE DE FOND DE LA SECTION, ET ELLE NE COÛTE PAS UN PIXEL DE HAUT.
 *
 * `#commander` vend les trois prestations — dont « votre visibilité sur Google »
 * en rangée de tête — et ne portait AUCUNE image sur 794 px. Elle en porte une
 * désormais, mais À FOND PERDU, DERRIÈRE les rangées : la photo occupe une place
 * qui existait déjà (le fond noir de la section) au lieu d'en réclamer une
 * nouvelle. Mesuré : la section fait exactement la même hauteur qu'avant.
 *
 * ═══ CE QUE LA PHOTO EST, ET CE QU'ELLE N'EST PAS ═══
 *
 * C'est une salle photographiée ENTIÈREMENT HORS MISE AU POINT — des pastilles
 * de bokeh ambrées, la masse sombre d'une suspension, un comptoir deviné. Rien à
 * lire à aucune définition : aucun texte, aucun visage, aucune enseigne, aucun
 * prix. C'est ce qui la rend admissible ici, où l'on affiche NOS tarifs : une
 * devanture reconnaissable derrière une grille de prix se lirait comme une
 * référence client, et nous n'en avons qu'une, nommée ailleurs.
 *
 * Elle est donc DÉCORATIVE au sens strict — `alt=""` ET `aria-hidden` (voir
 * `Photo.tsx`) : elle pose une ambiance derrière un texte qui dit déjà tout, et
 * la faire annoncer allongerait le trajet vers les trois prix sans rien ajouter.
 *
 * Source : Pexels (usage commercial, sans attribution) — voir
 * `public/photos/libre/PROVENANCE.md`, qui est le seul registre des licences.
 */
export const SERVICES_BAND: Shot = { src: "/photos/libre/ambiance-salle-nuit-bokeh.webp", alt: "" };

/* ── 5. Matériel — ce qu'on ne rachète pas ───────────────────── */

export type HardwareItem = {
  /** Sert à choisir le pictogramme dans `icons.tsx` — aucun emoji, la charte ne bouge pas. */
  id: "tablette" | "imprimante" | "ecran" | "reseau";
  label: string;
  /** SIX MOTS. Pas une phrase de brochure, pas deux lignes : six mots. */
  line: string;
};

/**
 * QUATRE PICTOGRAMMES, QUATRE LIGNES, ZÉRO PROSE.
 *
 * « Est-ce que ça marche chez MOI ? » est la question qui bloque le plus, et
 * la page n'y répondait qu'en sixième et huitième position d'un accordéon.
 * Elle est PROMUE hors de la FAQ, juste après la démonstration : la question se
 * pose exactement une fois dans le parcours, à cet endroit-là.
 *
 * C'est aussi la respiration la plus courte de la page, posée juste avant la
 * plus commerciale. Toute phrase ajoutée ici la détruit.
 *
 * « ÉCRAN CUISINE » EST DEVENU « TABLETTE CUISINE », et ce n'est pas un détail
 * de vocabulaire : un patron de snack qui lit « écran » comprend « il me faut
 * un écran de plus », c'est-à-dire un achat et un mur à percer. Une tablette,
 * il en a déjà une, ou il sait ce que ça coûte.
 */
export const HARDWARE: readonly HardwareItem[] = [
  { id: "tablette", label: "Tablette pour la caisse", line: "Android ou iPad. Aucun matériel propriétaire." },
  { id: "imprimante", label: "Imprimante ticket 80 mm", line: "En réseau. Ticket cuisine et sticker." },
  { id: "ecran", label: "Tablette pour la cuisine", line: "Ou un moniteur mural, si vous préférez." },
  { id: "reseau", label: "Connexion internet", line: "Une box suffit. Fibre non requise." },
] as const;

/**
 * LES DEUX VOIES — et la seconde manquait entièrement.
 *
 * La section disait « rien à racheter », ce qui est vrai et ne répond qu'à
 * MOITIÉ. Le restaurateur qui n'a pas de tablette, ou qui n'a aucune envie de
 * s'en occuper, se retrouvait sans réponse : la page lui expliquait qu'il
 * n'avait rien à acheter chez nous, pas qu'on pouvait tout lui poser.
 *
 * D'où deux voies affichées côte à côte, dans cet ordre : celle qui ne coûte
 * rien d'abord, celle qui se facture ensuite. Proposer l'installation avant de
 * dire qu'elle est facultative ferait lire un supplément obligatoire.
 *
 * « À PARTIR DE » et non un prix ferme : le chantier dépend du nombre de
 * postes, de la cuisine et du réseau en place. Annoncer 290 € tout court, c'est
 * garantir une mauvaise surprise à celui qui a trois écrans à poser.
 */
export const HARDWARE_PATHS = [
  {
    id: "vous",
    title: "Vous avez déjà le matériel",
    line: "Vous branchez, vous appairez avec un code à six caractères, et vous ouvrez le service. On reste au téléphone le temps qu'il faut.",
    // `euros(0)` et pas « 0 € » écrit à la main : c'est la même espace
    // insécable que les trois tarifs de la grille, face à laquelle ce zéro est
    // affiché.
    price: euros(0),
  },
  {
    id: "nous",
    title: "On vous équipe et on installe",
    line: "On fournit les tablettes et l'imprimante, on les configure à votre carte et à votre façon de travailler, et on pose tout sur place. Vous ouvrez le lendemain sans rien avoir à comprendre.",
    price: aPartirDe(INSTALL_FROM_CENTS),
  },
] as const;

/**
 * LE HORS-LIGNE — un demi-titre, pas une cinquième ligne.
 *
 * C'est notre vrai différenciant, il est implémenté (voir la colonne Cuisine de
 * `CATALOGUE`), et il était absent du hero, de Platform et du comparatif. Le
 * ranger dans une pastille de fonctionnalité serait le gâcher.
 */
export const HARDWARE_OFFLINE = {
  lead: "Et si le réseau tombe ?",
  line: "La caisse et la cuisine continuent en local : les tickets restent affichés et s'impriment. Tout se resynchronise au retour du réseau.",
} as const;

/* ── 6. Tarifs — les commissions, puis la grille ─────────────── */

/**
 * LE TABLEAU DES COMMISSIONS, EN TÊTE DE SECTION — trois lignes, et AUCUNE
 * phrase de plaidoyer autour. L'adjacence fait tout le travail.
 *
 * « Jusqu'à 30 % » et non « 30 % » : les taux varient selon le contrat et selon
 * qu'il s'agit de livraison ou de retrait. Annoncer un taux ferme qu'on n'a pas
 * vérifié, c'est offrir à un restaurateur l'occasion de nous corriger — et de
 * douter du reste.
 *
 * La troisième ligne est l'ancienne note de bas de section. L'AFFICHER
 * NOUS-MÊMES, au même rang que les deux autres, prouve qu'on ne dissimule
 * rien : un restaurateur qui compare 1,5 % à 30 % se convainc tout seul. Une
 * note qu'on soupçonne d'être cachée vend contre nous.
 */
export const COMMISSIONS = [
  { who: "Snack Manager", rate: "0 %", note: "un abonnement mensuel, rien de prélevé sur vos commandes" },
  { who: "Les plateformes", rate: "jusqu'à 30 %", note: "sur chaque commande livrée, et le client reste le leur" },
  { who: "Encaissement carte", rate: "≈ 1,5 %", note: "votre prestataire de paiement — cet argent ne nous revient pas" },
] as const;

/**
 * LA LISTE DE MODULES EST UNIQUE, ET C'EST TOUTE LA REFONTE DE LA GRILLE.
 *
 * Les trois colonnes portaient des listes CUMULATIVES (« Tout Starter,
 * plus : ») de quatre, cinq et trois lignes : le lecteur comparait des listes
 * de longueurs différentes et devait reconstruire de tête ce que chacune
 * contenait. Il lit désormais la MÊME liste trois fois, avec une pastille
 * pleine ou vide par ligne. Il n'a plus qu'une chose à trouver : où s'arrête
 * sa colonne.
 */
export type PlanModule = { id: string; label: string };

export const PLAN_MODULES: readonly PlanModule[] = [
  { id: "pos", label: "Caisse (POS)" },
  // « Écran cuisine » désignait ici un MODULE du logiciel, alors que la section
  // matériel utilise le mot pour un objet à acheter. Le catalogue dit déjà
  // « Cuisine (KDS) » : un seul nom pour une seule chose.
  { id: "kds", label: "Cuisine (KDS)" },
  { id: "print", label: "Ticket cuisine & sticker sac" },
  { id: "offline", label: "Mode hors-ligne" },
  { id: "bo", label: "Back-office : CA, commandes, exports CSV" },
  { id: "menu", label: "Menu & prix en direct" },
  { id: "planning", label: "Planning, pointage & coût de la semaine" },
  { id: "stocks", label: "Ingrédients, stocks & coût matière" },
  { id: "online", label: "Commande en ligne & click and collect" },
  { id: "loyalty", label: "Fidélité, codes promo & comptes clients" },
  { id: "priority", label: "Support prioritaire" },
] as const;

/**
 * LES DEUX PÉRIODICITÉS DU SÉLECTEUR — et « Par an » n'est pas une deuxième
 * grille.
 *
 * C'est la MÊME formule payée d'avance : douze mois pour le prix de dix. Deux
 * jeux de prix saisis côte à côte finiraient par diverger d'une révision à
 * l'autre, et le prospect qui compare les deux onglets est justement celui qui
 * lit le plus attentivement.
 */
export type BillingCycleId = "mensuel" | "annuel";

export type BillingCycle = {
  id: BillingCycleId;
  /** Le libellé de l'onglet — deux mots, pas une phrase. */
  label: string;
  /** La pastille qui pend à l'onglet annuel. `null` sur le mensuel. */
  hint: string | null;
};

export const BILLING_CYCLES: readonly BillingCycle[] = [
  { id: "mensuel", label: "Par mois", hint: null },
  // « 2 mois offerts » se déduit de la règle, il ne se saisit pas : le jour où
  // l'on facturerait onze mois, la pastille suivrait au lieu de mentir.
  { id: "annuel", label: "Par an", hint: `${12 - YEARLY_MONTHS_BILLED} mois offerts` },
] as const;

/**
 * LA PHRASE SOUS LE SÉLECTEUR, et elle doit tenir avec `ENGAGEMENT`.
 *
 * Le bandeau de la section dit « sans engagement, résiliable à tout moment » :
 * un onglet « Par an » posé au-dessus sans un mot se lit comme un démenti. On
 * dit donc lequel des deux engage — l'annuel, parce qu'il est réglé d'avance —
 * et on ne reformule jamais `ENGAGEMENT`, qui reste affichée telle quelle plus
 * bas.
 */
export const BILLING_YEARLY_NOTE =
  "Au mois, sans engagement. À l'année, douze mois réglés d'avance pour le prix de dix — deux mois offerts.";

export type Plan = {
  id: string;
  name: string;
  /**
   * LE PRIX MENSUEL, affiché — « 159 € ». Plus jamais « Sur devis ».
   *
   * C'est le prix de RÉFÉRENCE de la page : celui du sélecteur par défaut,
   * celui que cite le titre du simulateur, celui que publie l'extrait enrichi
   * de `page.tsx`. L'annuel s'en déduit, jamais l'inverse.
   */
  price: string;
  period: string;
  /** Le même montant, nu et en centimes — pour qui doit calculer plutôt qu'afficher. */
  monthlyCents: number;
  /** LE PRIX ANNUEL, déduit du mensuel — « 1 590 € ». */
  priceYearly: string;
  periodYearly: string;
  yearlyCents: number;
  /**
   * L'année ramenée au mois — « soit 132,50 € par mois ».
   *
   * C'est le SEUL chiffre de la colonne annuelle qui se compare à quoi que ce
   * soit : « 1 590 € » posé seul à côté de « 159 € » se lit comme dix fois
   * plus cher avant qu'on ait lu la période.
   */
  yearlyPerMonth: string;
  desc: string;
  /** Les `id` de `PLAN_MODULES` inclus dans la formule. */
  modules: readonly string[];
  popular?: boolean;
};

/**
 * Les deux prix d'une formule, à partir de son seul tarif mensuel.
 *
 * Écrit une fois et appelé trois fois : c'est ce qui garantit que les trois
 * lignes de la grille obéissent à la même règle. Un annuel saisi à la main sur
 * une seule des trois passerait toutes les relectures.
 */
function planPrices(monthlyCents: number) {
  const yearly = yearlyCents(monthlyCents);
  return {
    price: euros(monthlyCents),
    period: "par mois",
    monthlyCents,
    priceYearly: euros(yearly),
    periodYearly: "par an",
    yearlyCents: yearly,
    // Arrondi au centime : 1 990 / 12 tombe sur 165,833… et un tarif ne
    // s'affiche pas avec trois décimales.
    yearlyPerMonth: `soit ${euros(yearly / 12)} par mois`,
  };
}

/**
 * TROIS PRIX AFFICHÉS, ET « MULTI-SITES » QUITTE LA GRILLE.
 *
 * Les trois « Sur devis » forçaient la conversation ; combinés à « 7 places
 * restantes », ils produisaient de la pression sans information — exactement
 * le contraire de la confiance que la page passe dix sections à construire.
 * Le coût est assumé : un prospect peut s'auto-éliminer sans nous parler, et
 * un concurrent lit notre grille en trente secondes.
 *
 * « Multi-sites » sort parce que nous n'avons pas un client, encore moins un
 * groupe. Un exploitant à trois adresses ne voit plus rien qui lui soit
 * adressé, et c'est honnête.
 *
 * ═══ L'ÉCHELLE 99 → 159 → 199 EST UN CHOIX, PAS UNE MOYENNE ═══
 *
 * Ses écarts sont DÉCROISSANTS (+60, puis +40). Le haut de gamme se lit donc
 * comme la bonne affaire, alors qu'un troisième palier à 229 aurait rendu les
 * écarts croissants et produit l'effet inverse — c'est aussi ce qui rend Boost
 * moins cher que Complet plus le module (voir `PRICING_MATH`).
 */
export const PLANS: Plan[] = [
  {
    id: "essentiel",
    name: "Essentiel",
    ...planPrices(PLAN_MONTHLY_CENTS.essentiel),
    desc: "La caisse, la cuisine et le back-office. De quoi tenir un service.",
    modules: ["pos", "kds", "print", "offline", "bo", "menu"],
  },
  {
    id: "complet",
    name: "Complet",
    ...planPrices(PLAN_MONTHLY_CENTS.complet),
    desc: "Tout l'Essentiel, plus ce qui fait décider : le planning et le coût matière.",
    modules: ["pos", "kds", "print", "offline", "bo", "menu", "planning", "stocks"],
    popular: true,
  },
  {
    id: "boost",
    name: "Boost",
    ...planPrices(PLAN_MONTHLY_CENTS.boost),
    desc: "Tout, commande en ligne comprise. Vos clients commandent chez vous.",
    modules: [
      "pos",
      "kds",
      "print",
      "offline",
      "bo",
      "menu",
      "planning",
      "stocks",
      "online",
      "loyalty",
      "priority",
    ],
  },
];

/**
 * LE MODULE VENDU À PART, ET SON LIBELLÉ EST UNE DÉCISION.
 *
 * Il s'affiche « Commande en ligne & fidélité », JAMAIS « Livraison » : le mot
 * Livraison en face d'un prix se lit comme un livreur qu'on facture, et nous
 * ne fournissons aucun livreur — le tunnel s'arrête au créneau de retrait.
 */
export const MODULE_ADDON = {
  name: "Commande en ligne & fidélité",
  price: `${euros(MODULE_MONTHLY_CENTS)} par mois`,
  /**
   * LA MISE EN SERVICE A SA PROPRE CLÉ, et ce n'est pas un raffinement.
   *
   * Elle était absente de la grille alors qu'elle est facturée : un montant
   * qu'on découvre sur la première facture coûte bien plus cher que les 55 €
   * qu'il rapporte. Elle est donc affichée au même rang que l'abonnement, et
   * séparée pour qu'une carte puisse la poser sur sa propre ligne — c'est la
   * ligne que Boost fait disparaître.
   */
  setup: `${euros(MODULE_SETUP_CENTS)} de mise en service, la première fois`,
  line: `${euros(MODULE_SETUP_CENTS)} de mise en service la première fois. Se branche sur Essentiel ou sur Complet — les deux sont déjà compris dans Boost.`,
} as const;

/**
 * ═══ L'ADDITION, ÉCRITE FRANCHEMENT — on ne la laisse pas découvrir ═══
 *
 * Un prospect qui veut la commande en ligne a deux chemins : Complet plus le
 * module, ou Boost. S'il fait l'addition tout seul après avoir lu la grille et
 * qu'il trouve Boost moins cher, il se demande pourquoi on ne le lui a pas
 * dit. On la fait donc pour lui, en entier.
 *
 * ELLE SE RACONTE EN TROIS TEMPS, et c'est pour ça qu'elle est structurée
 * ainsi plutôt qu'écrite en phrases :
 *
 *   1. `stack`  — ce qu'on additionne : 159 + 79, plus 55 une seule fois ;
 *   2. `boost`  — ce que Boost coûte : 199, mise en service comprise ;
 *   3. `gaps`   — les trois écarts : 94 le premier mois, 39 par mois, 523 sur
 *                 douze mois.
 *
 * CHAQUE ÉTAPE PORTE SON LIBELLÉ ET SON MONTANT SÉPARÉMENT, jamais une phrase
 * toute faite : une carte qui déroule le calcul doit pouvoir faire apparaître
 * les lignes une à une, aligner les montants en colonne et n'animer que les
 * chiffres. Une phrase recousue ne se démonte pas.
 *
 * LE PREMIER MOIS EST LE TEMPS FORT, et c'est la mise en service qui le rend
 * tel : 293 contre 199. Le tenir caché derrière la moyenne mensuelle, ce
 * serait se priver du seul écart à trois chiffres de la page.
 *
 * TOUS CES NOMBRES SONT LES NÔTRES — aucune hypothèse de marché, aucun tarif
 * de concurrent. Ils se déduisent des quatre constantes du haut de fichier,
 * donc l'addition ne peut plus se tromper : c'était exactement son défaut, elle
 * ignorait la mise en service et additionnait deux prix qui n'étaient plus les
 * nôtres.
 */
const STACK_MONTHLY_CENTS = PLAN_MONTHLY_CENTS.complet + MODULE_MONTHLY_CENTS;
const STACK_FIRST_MONTH_CENTS = STACK_MONTHLY_CENTS + MODULE_SETUP_CENTS;
const BOOST_MONTHLY_CENTS = PLAN_MONTHLY_CENTS.boost;
/** Douze mois de l'un contre douze mois de l'autre — la mise en service ne compte qu'une fois. */
const STACK_YEAR_CENTS = STACK_MONTHLY_CENTS * 12 + MODULE_SETUP_CENTS;
const BOOST_YEAR_CENTS = BOOST_MONTHLY_CENTS * 12;

/** Une ligne du calcul : ce qu'on compte, combien, et à quel titre. */
export type MathLine = {
  label: string;
  /** Déjà formaté (« 159 € »), ou le mot qui remplace un montant (« Comprise »). */
  amount: string;
  /** La périodicité ou la condition — « par mois », « une seule fois ». */
  note?: string;
};

/** Un écart : quand, combien, et l'opération qui le produit. */
export type MathGap = { label: string; amount: string; detail: string };

export type PricingMath = {
  /** Temps 1 — ce qu'on additionne à côté de Boost. */
  stack: { title: string; steps: readonly MathLine[]; firstMonth: MathLine; everyMonth: MathLine };
  /** Temps 2 — ce que Boost coûte, mise en service comprise. */
  boost: { title: string; steps: readonly MathLine[]; firstMonth: MathLine; everyMonth: MathLine };
  /** Temps 3 — les trois écarts, du plus spectaculaire au plus durable. */
  gaps: { title: string; items: readonly MathGap[] };
  /** La conclusion en une ligne, pour qui ne lit pas le tableau. */
  line: string;
};

export const PRICING_MATH: PricingMath = {
  stack: {
    title: "Complet, plus le module",
    steps: [
      { label: "Complet", amount: euros(PLAN_MONTHLY_CENTS.complet), note: "par mois" },
      { label: MODULE_ADDON.name, amount: euros(MODULE_MONTHLY_CENTS), note: "par mois" },
      { label: "Mise en service du module", amount: euros(MODULE_SETUP_CENTS), note: "une seule fois" },
    ],
    firstMonth: { label: "Le premier mois", amount: euros(STACK_FIRST_MONTH_CENTS) },
    everyMonth: { label: "Puis chaque mois", amount: euros(STACK_MONTHLY_CENTS) },
  },
  boost: {
    title: "Boost",
    steps: [
      { label: "Tout Complet, la commande en ligne et la fidélité comprises", amount: euros(BOOST_MONTHLY_CENTS), note: "par mois" },
      // La ligne qui fait tout le travail : en face des 55 €, un mot au lieu
      // d'un montant. C'est le seul endroit de la page où l'absence de chiffre
      // vaut mieux qu'un chiffre.
      { label: "Mise en service", amount: "Comprise", note: "rien à régler la première fois" },
    ],
    firstMonth: { label: "Le premier mois", amount: euros(BOOST_MONTHLY_CENTS), note: "mise en service comprise" },
    everyMonth: { label: "Puis chaque mois", amount: euros(BOOST_MONTHLY_CENTS) },
  },
  gaps: {
    title: "Ce que Boost vous fait économiser",
    items: [
      {
        label: "Le premier mois",
        amount: euros(BOOST_MONTHLY_CENTS - STACK_FIRST_MONTH_CENTS),
        detail: `${euros(STACK_FIRST_MONTH_CENTS)} contre ${euros(BOOST_MONTHLY_CENTS)}`,
      },
      {
        label: "Chaque mois ensuite",
        amount: euros(BOOST_MONTHLY_CENTS - STACK_MONTHLY_CENTS),
        detail: `${euros(STACK_MONTHLY_CENTS)} contre ${euros(BOOST_MONTHLY_CENTS)}`,
      },
      {
        label: "Sur douze mois",
        amount: euros(BOOST_YEAR_CENTS - STACK_YEAR_CENTS),
        detail: `${euros(STACK_YEAR_CENTS)} contre ${euros(BOOST_YEAR_CENTS)}`,
      },
    ],
  },
  line: `Au-delà du Complet, Boost coûte ${euros(STACK_FIRST_MONTH_CENTS - BOOST_MONTHLY_CENTS)} de moins le premier mois, puis ${euros(STACK_MONTHLY_CENTS - BOOST_MONTHLY_CENTS)} chaque mois — ${euros(STACK_YEAR_CENTS - BOOST_YEAR_CENTS)} sur douze mois.`,
};

/**
 * L'ASTÉRISQUE DU « 0 % », en note discrète sous la grille.
 *
 * Elle dit la chose qu'un restaurateur découvrirait autrement sur son premier
 * relevé, et un mensonge par omission au premier relevé coûte le client entier.
 * « Environ 1,5 % » et non un taux ferme : il dépend du prestataire de paiement
 * et de la carte présentée, et nous ne le fixons pas.
 */
export const PRICING_FOOTNOTE =
  "* Aucune commission sur vos ventes. Seuls s'appliquent les frais d'encaissement de votre prestataire de paiement — environ 1,5 % par transaction carte — que vous régleriez avec n'importe quelle solution de paiement en ligne.";

/* ── 7. Le calcul — simulateur ───────────────────────────────── */

/**
 * LES DEUX LIGNES AU-DESSUS DES CURSEURS — ce qui reste d'Intro.
 *
 * La phrase la plus forte de la page était posée seule sur un filigrane géant,
 * sans une preuve à portée de regard. Elle devient l'affirmation immédiatement
 * suivie du calcul qui la produit.
 *
 * DEUX MOTS SONT TOMBÉS, ET CHACUN POUR SA RAISON. « Parfois deux » ne sort
 * d'aucun calcul et n'a été constaté chez personne. « On enlève un poste » est
 * écarté délibérément : chez un patron de snack, ce poste c'est souvent sa
 * belle-sœur au comptoir, et « enlever un poste » sonne comme un consultant qui
 * vient conseiller un licenciement.
 */
export const SIM_LEAD = {
  title: "On n'ajoute pas un outil.",
  line: "On vous rend les heures que votre organisation vous prend.",
} as const;

/**
 * L'AMORCE, RAMENÉE DE SOIXANTE MOTS À DEUX LIGNES, ses deux montants sortis
 * en cases de chiffres — ils se lisaient noyés au milieu d'un paragraphe.
 */
export const SIM_ESC = {
  line: "Une commande mal relue, c'est un plat refait. Deux par service, midi et soir, 7 j/7.",
  figures: [
    { fig: "≈ 5,75 €", label: "le plat qu'on refait" },
    { fig: "≈ 700 €", label: "par mois, à la poubelle" },
  ],
} as const;

/**
 * LES DEUX HYPOTHÈSES EXTÉRIEURES, EN CORPS DE TEXTE SOUS LES CURSEURS —
 * jamais en nombres géants au-dessus.
 *
 * C'est tout ce qui survit de ProofBand, et elle était innocente du crime dont
 * on l'accusait : c'est la seule section qui citait une source extérieure, elle
 * ne plaidait pas. Son tort était sa POSITION — cent pixels au-dessus du
 * simulateur, à qui elle volait ses deux chiffres. Les remonter en nombres
 * géants ici, ce serait la reconstruire à l'intérieur de la section qui l'a
 * exécutée.
 *
 * LE +15 % A QUITTÉ LE CALCUL. Il s'annonçait « bas de fourchette des études » ;
 * vérification faite, les seules sources qui l'avancent (15 à 30 %) sont des
 * éditeurs qui vendent la même chose que nous. Citer un vendeur pour appuyer une
 * vente ne prouve rien. Or ce taux pesait 61 % du chiffre annuel affiché : il ne
 * reste donc plus une seule hypothèse maison dans le total.
 *
 * ET ON NE LE RACONTE PAS. Un bloc ouvert titrait un temps « le seul chiffre que
 * nous n'avons pas mesuré nous-mêmes » et détaillait ce qu'on avait refusé de
 * compter. Chaque phrase était exacte, l'ensemble sonnait faux : devancer une
 * objection que personne n'a formulée, c'est s'accuser tout seul. Il ne reste que
 * ce dépliable — disponible pour qui cherche, silencieux pour les autres.
 */
export const SIM_NOTES =
  "Hypothèses prudentes, ajustées ensemble en démo : coût horaire chargé 13 €/h (SMIC restauration 2026 + charges) · commande refaite ≈ 50 % du panier · appel ≈ 3 min + 1 min d'interruption/reprise de poste, 60 % des appels migrent en ligne · erreurs −35 % (Deliverect, 2023) · 2 services/jour, 30,4 jours/mois.";

/**
 * LA PHRASE QUI RECOUD LA PAGE.
 *
 * C'est le SEUL endroit où une section en cite une autre, et c'est le modèle
 * qui remplace la redondance supprimée : les sections ne se répètent plus,
 * elles se citent. Elle est reprise à l'identique dans `CONTACT_POINTS`.
 */
export const SIM_CTA_NOTE = "On repart avec vos chiffres.";

/* ── 8. Lancement — les jalons ───────────────────────────────── */

export type Milestone = {
  /** La DATE, et elle porte sur ce que NOUS livrons. */
  when: string;
  title: string;
  /** Deux lignes, pas trois. */
  lines: readonly [string, string];
};

/**
 * ON DATE CE QU'ON LIVRE, JAMAIS CE QUE LE CLIENT GAGNERA.
 *
 * C'est la seule réponse honnête possible au « +30 % en 60 jours » du
 * concurrent, et la seule qui tienne sans un client : une date que nous tenons
 * SEULS ne peut être démentie que par nous. Aucun de ces quatre jalons ne
 * dépend du marché, de la saison ou de la clientèle du restaurateur.
 *
 * Le fond de PROC_TEXTS survit ici — on observe, on configure, on reste — mais
 * il change de forme : Process était écrit comme une frise et rendu comme trois
 * cartes identiques à celles qui l'entouraient. On lui rend sa forme.
 */
export const MILESTONES: readonly Milestone[] = [
  {
    when: "Jour 1",
    title: "La démonstration",
    lines: ["Trente minutes, chez vous ou en visio.", "On repart avec vos chiffres du simulateur."],
  },
  {
    when: "Semaine 1",
    title: "La configuration",
    lines: ["Menu, équipe, couleurs, moyens de paiement, imprimante.", "C'est nous qui la faisons, pas vous."],
  },
  {
    when: "Jour d'ouverture",
    title: "On est là",
    lines: ["Midi et soir, dans votre cuisine.", "Le premier service se passe avec nous."],
  },
  {
    when: "Ensuite",
    title: "On reste",
    lines: ["Mises à jour incluses, support, corrections.", "Vos données exportables quand vous voulez."],
  },
] as const;

/* ── 9. FAQ ──────────────────────────────────────────────────── */

/**
 * HUIT ENTRÉES RAMENÉES À CINQ, ET L'ACCORDÉON CESSE D'ÊTRE UN PLACARD.
 *
 * Trois questions sont PROMUES dans leur section — matériel et hors-ligne en
 * section 5, délai de mise en route en section 8 — parce qu'elles se posent à
 * un endroit précis du parcours et pas à la fin. Une quatrième (« Puis-je
 * garder mon site actuel ? ») est absorbée par la troisième rangée des canaux.
 * La cinquième (« C'est quoi, une marque virtuelle ? ») part avec les marques
 * blanches, reportées hors de la landing.
 *
 * Deux entrées neuves, et les deux disent ce qu'on préférerait taire. « Vous
 * avez combien de clients ? » est l'objection numéro un d'un produit jeune :
 * l'écrire nous-mêmes vaut mieux que de la laisser découvrir — c'est exactement
 * ce que le compteur « 3 places prises » essayait de cacher. « Est-ce que vous
 * livrez ? » ferme la porte que toute la page laisse entrouverte.
 */
export const FAQ = [
  {
    q: "C'est adapté à quel type de restaurant ?",
    a: "Pensé pour les fast-foods et snacks indépendants — sur place, à emporter ou en click & collect.",
  },
  {
    q: "Vous avez combien de clients ?",
    a: "Un. Class'Food, à Perriers-sur-Andelle, en service 7 j/7 : c'est notre restaurant pilote, et chaque écran y est testé midi et soir. Nous ouvrons dix places de lancement — vous seriez parmi les dix premiers, et vous gardez votre tarif à vie.",
  },
  {
    q: "Y a-t-il un engagement de durée ?",
    // La réponse d'hier (« on vous détaille les conditions au moment du devis »)
    // contredisait le hero qui affichait « Sans engagement ». On affiche la
    // constante, pas une reformulation : c'est ce qui garantit qu'elle ne
    // divergera plus du bandeau tarifaire.
    a: ENGAGEMENT,
  },
  {
    q: "Est-ce que vous livrez ?",
    a: "Non, et nous n'avons jamais eu l'intention de le faire. Le tunnel de commande s'arrête au créneau de retrait. La livraison, quand il y en a une, reste la vôtre — vos tournées, vos horaires.",
  },
  {
    q: "À qui appartiennent mes données ?",
    a: "À vous. Ventes, clients, menus : tout est exportable à tout moment (CSV), hébergé en Europe.",
  },
] as const;

/* ── 10. Le pilote — né au comptoir ──────────────────────────── */

/**
 * LA CITATION RACONTE UNE RENCONTRE, PLUS UNE ORIGINE.
 *
 * Elle disait « Snack Manager est né derrière le comptoir de notre restaurant
 * pilote » : l'outil au centre, au moment précis où le lecteur cherche des
 * gens. Ce qu'il veut savoir avant de laisser son numéro, c'est à QUI il le
 * laisse — et la réponse est deux métiers qui se sont trouvés, pas un logiciel
 * qui a poussé tout seul.
 *
 * Elle a perdu au passage sa première moitié d'origine (« tickets perdus en
 * plein rush, téléphone qui sonne pendant l'encaissement ») : la section 2 dit
 * les douleurs une fois pour toutes.
 */
export const FOUNDER_QUOTE =
  "« D'un côté, un restaurateur qui tient son snack et connaît chaque friction du service par cœur. De l'autre, un expert de la tech. On s'est rencontrés, on a regardé le problème ensemble, et on a construit l'outil qui manquait. Chaque écran est testé en service réel, midi et soir, avant d'arriver chez vous. »";

/**
 * LES PHOTOS — UN CÂBLAGE CASSÉ, PAS UN MANQUE D'IMAGES.
 *
 * Sept des huit chemins référencés ici pointaient sur des fichiers ABSENTS du
 * disque (sandwichs1.jpeg, tacos.jpeg, classiques.jpeg, paninis.jpeg,
 * salades-barquettes.jpeg, enfant-glaces.jpeg, sandwichs3.jpeg) : trois
 * sections rendaient sept cartouches sombres par le repli de `Photo.tsx`, sans
 * que personne s'en aperçoive. `public/photos` contient dix-sept images
 * réelles ; on repointe au lieu de supprimer.
 *
 * ═══ DES SCÈNES DE SERVICE, PLUS DES ASSIETTES ═══
 *
 * Le collage montrait trois visuels de la CARTE du pilote — un tacos gratiné,
 * un smash burger, un panini. Verdict du fondateur : « ce n’est pas pro, ce
 * n’est pas ce que je veux ». Il a raison, et pour une raison qui dépasse le
 * goût : la section s’appelle désormais « Un expert de la tech, un
 * restaurateur, et le logiciel qui leur manquait ». Des assiettes n’illustrent
 * pas une rencontre entre deux personnes. Un comptoir, un service, si.
 *
 * ═══ ET ELLES NE PEUVENT PLUS ÊTRE LÉGENDÉES « CLASS’FOOD » ═══
 *
 * Les anciennes étaient de vraies photos du pilote, et leurs textes alternatifs
 * le disaient. Celles-ci sont des photographies de banque libres de droits :
 * les présenter comme le restaurant pilote serait exactement le défaut qu’on
 * traque depuis le début. Elles sont donc DÉCORATIVES — `alt` vide et
 * `aria-hidden`. La preuve du pilote reste ce qu’elle a toujours été : la
 * commune nommée, la citation, et une démonstration qu’on manipule.
 *
 * Deux images plutôt que trois : je n’en ai trouvé que deux qui tiennent la
 * charte sans marque tierce ni texte étranger, et un collage de deux justes
 * vaut mieux qu’un de trois dont le dernier est faible.
 *
 * Provenance et licences : `public/photos/libre/PROVENANCE.md`.
 */
export const FOUNDER_PHOTO: Shot = {
  src: "/photos/libre/service-sous-lampe.webp",
  alt: "",
};

/** La vignette qui accompagne la citation — un comptoir en service. */
export const PILOTE_PHOTOS: Shot[] = [
  { src: "/photos/libre/comptoir-vignette.webp", alt: "" },
];

/**
 * UN SEUL FAIT. Les deux autres (« Rodé sur de vrais rushs », « Amélioré chaque
 * semaine ») sont déjà dans la citation, mot pour mot ou presque.
 */
export const FOUNDER_FACTS = ["Testé en service réel 7 j/7"] as const;

/* ── 11. Contact ─────────────────────────────────────────────── */

export const CALLBACK_SLOTS = [
  { value: "matin", label: "Plutôt le matin" },
  { value: "entre-services", label: "Entre les services (14h–18h)" },
  { value: "apres-21h", label: "Après 21h" },
] as const;

/**
 * LES TROIS POINTS À GAUCHE DU FORMULAIRE, compteur de places retiré.
 *
 * Le deuxième est repris à l'identique de `SIM_CTA_NOTE` : c'est la couture
 * qui remplace la redondance supprimée.
 */
export const CONTACT_POINTS = [
  "On vous rappelle sous 24 h ouvrées",
  "On repart avec vos chiffres du simulateur",
  FOUNDER_POLICY,
] as const;

/**
 * LÀ OÙ ATTERRIT L'ACCOMPAGNEMENT SUR LES PLATEFORMES — une case à cocher, et
 * rien d'autre.
 *
 * L'en-tête chiffrait ce service (« le service à 99 € ») alors qu'il n'a plus
 * de prix propre depuis qu'il est compris dans la mise en route, et le montant
 * qu'il citait est devenu celui d'une FORMULE : un relecteur pressé pouvait
 * lire ici un tarif d'abonnement posé sur un formulaire de contact.
 *
 * « Voulez-vous qu'on améliore vos pages Uber Eats et Deliveroo ? » n'est pas
 * une question que le visiteur se pose sur cette page : celui qui est sur les
 * plateformes est venu voir comment s'en affranchir, celui qui n'y est pas ne
 * comprend pas de quoi on parle. Mais le formulaire est le seul endroit où
 * c'est NOUS qui posons les questions — et une question qu'on pose devient
 * légitime.
 *
 * SANS PRIX, SANS PROMESSE, SANS DÉLAI. Le « +30 % à 60 jours » est un chiffre
 * de RÉSULTAT sur ZÉRO client, et c'est mot pour mot ce que le concurrent
 * publie comme résultat observé : côte à côte, notre page se lisait comme sa
 * copie sans sa preuve.
 *
 * `help` n'est pas décoratif : une case sans motif est une friction, une case
 * avec sa phrase est une question.
 */
export const CONTACT_PLATFORMS = {
  name: "platforms",
  label: "Vous vendez déjà sur Uber Eats ou Deliveroo ?",
  help: "On regarde vos pages avec vous pendant l'appel.",
} as const;
