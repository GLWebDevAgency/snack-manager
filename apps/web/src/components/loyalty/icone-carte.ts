import {
  WCAG_AA_NON_TEXTE,
  ajusterJusquaAA,
  luminance,
  melanger,
  textePosableSur,
  type Brand,
  type BrandShape,
} from "@sm/contracts";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ICÔNE DE LANCEMENT D'UNE CARTE DE FIDÉLITÉ — DES FORMES, JAMAIS DU TEXTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ce que cette icône remplace : un rectangle arrondi, un disque d'accent, et
 * l'initiale du restaurant posée en `system-ui`. Trois défauts, tous corrigés
 * ici.
 *
 * ═══ 1. AUCUNE POLICE ═══
 *
 * `system-ui` dans un SVG rendu par un lanceur Android n'est pas une police :
 * c'est ce que la plateforme veut bien donner ce jour-là. Selon l'appareil, le
 * même fichier rendait une grotesque, une Noto, ou — quand le moteur de rendu
 * d'icônes ne charge aucune fonte du tout — RIEN, un disque nu. Une icône ne
 * peut pas dépendre d'un glyphe. Il n'y a donc plus une seule lettre ici :
 * uniquement des rectangles, des disques et des arcs, dont la forme est
 * entièrement décrite par ce fichier.
 *
 * Le prix à payer, dit franchement : l'icône ne porte plus l'INITIALE du
 * restaurant. Ce qui la distingue est sa PALETTE (les cinq couleurs du masque)
 * et sa FORME (net / doux / rond) — et, dès que le restaurateur en dépose un,
 * son vrai logo : `dessinerIconeLogo` le pose alors LUI-MÊME au centre de
 * l'icône du lanceur, et il garde par ailleurs la première place du manifeste.
 *
 * ═══ 2. DEUX RÔLES, DEUX DESSINS ═══
 *
 * Une icône `maskable` est rognée par le lanceur dans un cercle, un carré
 * arrondi ou une goutte, selon le téléphone : la spécification ne garantit que
 * le CERCLE CENTRAL de 80 % du canevas (`RATIO_ZONE_SURE`). Tout ce qui en
 * sort peut disparaître. Une icône `any`, elle, n'est pas rognée : lui donner
 * la même marge la ferait simplement paraître PLUS PETITE que ses voisines sur
 * l'écran d'accueil.
 *
 * La même image ne peut donc pas tenir les deux rôles. `dessinerIconeCarte`
 * prend une `FormeIcone` et rend deux dessins différents à partir de la même
 * géométrie : `masquable` inscrit le contenu dans la zone sûre et remplit tout
 * le canevas d'un aplat (le lanceur doit pouvoir rogner sans trouver de vide) ;
 * `plein` agrandit le contenu de ~19 % et lui donne sa propre tuile arrondie.
 *
 * ═══ 3. DES COUCHES, ET DU CONTRASTE VÉRIFIÉ ═══
 *
 * Six couches : l'aplat de fond, le halo d'accent, la carte du dessous, l'ombre
 * portée, la carte du dessus (dégradé + liseré) et les trois tampons. Deux
 * couples portent l'information et sont donc MESURÉS (`icone-carte.test.ts`),
 * pas espérés :
 *
 *   · liseré / fond — le contour qui détache la carte du canevas. Sur Soleil,
 *     l'accent safran sur le sable ne mesure que 2,2:1 : sans ce liseré, la
 *     carte se dissout dans son propre fond. Le liseré est l'accent ramené à
 *     3:1 (1.4.11 — c'est un élément, pas du texte) ;
 *   · tampons / carte — c'est le couple `onAccent/accent`, celui-là même que
 *     `contraste()` prouve déjà sur les six directions.
 *
 * ═══ 4. ET QUAND UN LOGO EST POSÉ, C'EST LUI QU'ON VOIT ═══
 *
 * `dessinerIconeLogo` compose la variante MASQUABLE autour du logo du
 * restaurateur : le fond du masque sur tout le canevas — le lanceur doit
 * pouvoir rogner sans jamais trouver de vide — et le logo inscrit dans le plus
 * grand carré qui tienne dans la zone sûre, en `preserveAspectRatio` « meet »,
 * donc AJUSTÉ et jamais recadré. C'est la règle que l'éditeur de marque écrit
 * déjà en toutes lettres : un logo recadré n'est plus un logo.
 *
 * Les deux cartes disparaissent alors, et ce n'est pas un caprice : le dessin
 * généré occupe DÉJÀ tout le rayon sûr (196,6 des 204,8 garantis). Il n'y a
 * pas de place pour poser un logo à côté sans rogner l'un ou l'autre. Entre
 * notre dessin et le sien, on garde le sien.
 *
 * Le logo entre par un attribut `href` — la seule valeur de tout ce fichier
 * qui ne soit ni un nombre calculé ici ni un hexadécimal validé par le
 * contrat. Elle est donc bornée deux fois (`hrefIncorporable`) : une adresse
 * `data:` d'image RASTER, ou une URL http(s), et rien d'autre ; puis échappée
 * en XML. Un `data:image/svg+xml` est refusé nommément — un SVG incorporé dans
 * un SVG y rapatrie tout ce que le format sait faire, script compris.
 */

/** Le côté du canevas. 512 est la taille de référence d'une icône de manifeste. */
export const TAILLE = 512;

/**
 * La zone sûre d'une icône masquable : le cercle centré de 80 % du côté.
 * (W3C Manifest, `purpose: "maskable"` — « the safe zone is a circle with
 * diameter 80% of the icon's minimum dimension ».)
 */
export const RATIO_ZONE_SURE = 0.8;

/** Le rôle de l'icône dans le manifeste. Le paramètre `forme` de la route. */
export type FormeIcone = "plein" | "masquable";

export const FORMES_ICONE: readonly FormeIcone[] = ["plein", "masquable"];

/** Lit le paramètre d'URL sans jamais échouer : tout le reste vaut `plein`. */
export function formeDemandee(valeur: string | null): FormeIcone {
  return valeur === "masquable" ? "masquable" : "plein";
}

/**
 * L'INCLINAISON DES DEUX CARTES.
 *
 * Une carte posée droite se lit comme un simple rectangle ; inclinée, elle se
 * lit comme un OBJET posé sur un plan. C'est le seul écart à l'orthogonalité
 * du dessin, et il est faible exprès : au-delà d'une dizaine de degrés, les
 * bords crénelés deviennent visibles à 48 px.
 */
const ANGLE = -9;

type Rectangle = {
  /** Centre, dans le repère local (origine au centre du canevas). */
  cx: number;
  cy: number;
  largeur: number;
  hauteur: number;
};

/**
 * LES DEUX CARTES, dans un repère local centré — la mise à l'échelle vient
 * après, et elle seule dépend du rôle de l'icône.
 *
 * Le rapport 168 / 108 ≈ 1,56 est celui d'une carte bancaire (85,6 × 53,98 mm,
 * soit 1,586) : c'est l'objet que le client range dans son portefeuille, et
 * l'œil reconnaît ce rapport avant de reconnaître quoi que ce soit d'autre.
 * La carte du dessous est décalée vers le haut-gauche : c'est elle qui fait la
 * PILE, donc l'épaisseur.
 */
const CARTE_DESSUS: Rectangle = { cx: 5, cy: 7, largeur: 172, hauteur: 110 };
const CARTE_DESSOUS: Rectangle = { cx: -13, cy: -13, largeur: 172, hauteur: 110 };

/** De combien l'ombre portée descend sous la carte du dessus. */
const DECALAGE_OMBRE = 9;
/** L'épaisseur du liseré. Il déborde de la moitié, de part et d'autre du tracé. */
const TRAIT_CARTE = 4;

/**
 * TOUT CE QUI EST PEINT, ombre portée comprise — c'est cette liste qui borne
 * le dessin. L'oublier était l'erreur facile : l'ombre déborde de neuf unités
 * sous la carte, et sur une icône masquable ces neuf unités sont exactement le
 * genre de chose qu'un lanceur en goutte tranche.
 */
const CARTES: readonly Rectangle[] = [
  CARTE_DESSUS,
  CARTE_DESSOUS,
  { ...CARTE_DESSUS, cy: CARTE_DESSUS.cy + DECALAGE_OMBRE },
];

/**
 * LES TROIS TAMPONS — la seule figure du dessin, et c'est celle du métier.
 *
 * Deux pleins, un vide : une carte à tamponner, en cours. C'est aussi ce que
 * raconte la jauge de la page (« encore N points »), si bien que l'icône et la
 * carte disent la même chose.
 *
 * TROIS ET NON SIX : à 48 px, un tampon mesure environ 5 px de diamètre. Six
 * tampons y auraient fondu en une bande grise ; trois restent trois.
 */
const RAYON_TAMPON = 17;
const ECART_TAMPON = 40;
const TRAIT_TAMPON = 7;
/** Les tampons sont posés un peu SOUS l'axe : le haut de la carte reste libre. */
const DECALAGE_TAMPONS = 8;

/**
 * LE RAYON DES ANGLES SUIT LA FORME CHOISIE PAR LE RESTAURATEUR.
 *
 * Ce ne sont PAS les rayons en pixels du masque (`--cf-r-*`, 2 à 28 px) : ceux-ci
 * sont accordés à une interface de 16 px de texte, pas à un canevas de 512. Ce
 * qui se reporte d'une échelle à l'autre est la PROPORTION — la part du plus
 * petit côté que l'angle mange. D'où deux tables, la même intention.
 */
const RAYON_CARTE: Record<BrandShape, number> = { net: 0.06, doux: 0.14, rond: 0.24 };
/**
 * La tuile de la variante `plein` suit la même forme. Un plancher élevé
 * néanmoins : une tuile à angle vif sur un écran d'accueil Android se lit comme
 * une image mal découpée, pas comme un parti pris.
 */
const RAYON_TUILE: Record<BrandShape, number> = { net: 0.13, doux: 0.19, rond: 0.26 };

type Point = { x: number; y: number };

function coins(r: Rectangle): Point[] {
  const dx = r.largeur / 2;
  const dy = r.hauteur / 2;
  return [
    { x: r.cx - dx, y: r.cy - dy },
    { x: r.cx + dx, y: r.cy - dy },
    { x: r.cx + dx, y: r.cy + dy },
    { x: r.cx - dx, y: r.cy + dy },
  ];
}

function pivoter({ x, y }: Point, degres: number): Point {
  const a = (degres * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}

/**
 * Le rayon du cercle qui contient TOUT le dessin, ombre portée comprise.
 *
 * Calculé et non écrit : c'est lui qui garantit la zone sûre masquable, et une
 * constante recopiée à la main mentirait au premier déplacement d'un
 * rectangle. La rotation ne change aucune distance à l'origine — mais on la
 * conserve dans le calcul pour que la formule reste vraie si l'un des deux
 * rectangles cessait d'être centré sur l'origine du pivot.
 */
export function rayonDuContenu(): number {
  const points = CARTES.flatMap((c) => coins(c).map((p) => pivoter(p, ANGLE)));
  return Math.max(...points.map((p) => Math.hypot(p.x, p.y))) + TRAIT_CARTE / 2;
}

/** La boîte englobante du dessin incliné — ce qui décide de l'échelle `plein`. */
export function boiteDuContenu(): { largeur: number; hauteur: number } {
  const points = CARTES.flatMap((c) => coins(c).map((p) => pivoter(p, ANGLE)));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    largeur: Math.max(...xs) - Math.min(...xs) + TRAIT_CARTE,
    hauteur: Math.max(...ys) - Math.min(...ys) + TRAIT_CARTE,
  };
}

/**
 * LA MARGE DE LA VARIANTE `plein`, en part du canevas.
 *
 * Elle existe pour deux raisons, et aucune n'est la découpe du lanceur : le
 * dessin ne doit pas affleurer les angles arrondis de sa propre tuile, et
 * l'ombre portée a besoin d'un peu d'air sous la carte.
 */
const MARGE_PLEIN = 0.06;

/** L'échelle appliquée au dessin selon le rôle. Exportée pour être mesurée. */
export function echelle(forme: FormeIcone): number {
  if (forme === "masquable") {
    /*
     * Le contenu s'inscrit dans la zone sûre, avec 4 % de retrait : la
     * spécification donne le cercle de 80 % comme une GARANTIE, pas comme une
     * cible à effleurer, et les lanceurs qui rognent en goutte mordent un peu
     * plus que le cercle sur un des quatre côtés.
     */
    return ((TAILLE * RATIO_ZONE_SURE) / 2) * 0.96 / rayonDuContenu();
  }
  const boite = boiteDuContenu();
  const utile = TAILLE * (1 - 2 * MARGE_PLEIN);
  return Math.min(utile / boite.largeur, utile / boite.hauteur);
}

/** Les couleurs du dessin, toutes dérivées du masque — aucune n'est écrite ici. */
export type CouleursIcone = {
  fond: string;
  halo: string;
  dessous: string;
  hautDeCarte: string;
  basDeCarte: string;
  liseré: string;
  ombre: string;
  tampon: string;
};

/**
 * De combien la carte se creuse entre son haut et son bas. Au-delà d'un
 * cinquième, la nuance cesse d'être une matière et devient une seconde couleur.
 */
const PROFONDEUR = 0.2;

/**
 * ═══ D'OÙ VIENNENT LES HUIT COULEURS ═══
 *
 * ═══ LE DÉGRADÉ NE PEUT PAS ÊTRE « PLUS CLAIR EN HAUT » ═══
 *
 * Première version, et elle était fausse : le haut de carte valait l'accent
 * poussé de 16 % vers la plus CLAIRE des deux couleurs de socle, pour figurer
 * la lumière. Mesuré, c'était un piège — sur Atelier et sur Marché, dont
 * l'encre des tampons (`onAccent`) est elle-même claire, éclaircir l'accent
 * RAPPROCHE le fond de la figure qu'il porte : 4,00:1 et 3,55:1, sous le
 * plancher AA que le contrat garantit pourtant sur `onAccent/accent`. La
 * lumière effaçait les tampons.
 *
 * La règle qui la remplace n'a qu'un sens possible : la carte se creuse
 * TOUJOURS À L'OPPOSÉ de l'encre des tampons (`textePosableSur(onAccent)` rend
 * ce pôle). Le contraste avec les tampons ne peut alors que croître, jamais
 * décroître — la garantie du contrat devient le PIRE cas du dégradé, pas son
 * espoir. Une extrémité vaut exactement l'accent du restaurant ; l'autre en
 * est la nuance creusée.
 *
 * Reste à savoir laquelle des deux va en haut. La plus CLAIRE, toujours : la
 * lumière vient d'en haut sur les six directions, et cette fois c'est la
 * luminance qui le décide, jamais l'étiquette `mode`.
 */
export function couleursDe(brand: Brand): CouleursIcone {
  const p = brand.palette;
  const creusee = melanger(p.accent, textePosableSur(p.onAccent), PROFONDEUR);
  const [hautDeCarte, basDeCarte] =
    luminance(creusee) > luminance(p.accent) ? [creusee, p.accent] : [p.accent, creusee];

  return {
    fond: p.ground,
    halo: p.accent,
    /*
     * La carte du dessous doit se détacher du fond SANS jamais rivaliser avec
     * celle du dessus : la surface poussée d'un dixième vers l'encre suffit —
     * c'est l'élévation d'un « élément » du masque, à peine appuyée. Sur
     * Marché, où `surface` (#f4f8f4) et `ground` (#ffffff) sont presque égaux,
     * c'est ce dixième qui rend la pile visible.
     */
    dessous: melanger(p.surface, p.ink, 0.22),
    hautDeCarte,
    basDeCarte,
    /*
     * LE LISERÉ EST MESURÉ, PAS DÉCORATIF. Il porte la limite de la carte —
     * donc de l'objet entier — sur un fond qui peut être de la même famille de
     * teinte que l'accent (Soleil : safran sur sable, 2,2:1). 3:1 est le
     * plancher des éléments non textuels (WCAG 1.4.11) et c'est exactement le
     * rôle joué ici. `ajusterJusquaAA` rend la nuance la PLUS PROCHE qui passe :
     * sur les cinq autres directions le liseré reste l'accent, au bit près.
     */
    liseré: ajusterJusquaAA(p.accent, [p.ground], WCAG_AA_NON_TEXTE).couleur,
    /*
     * L'OMBRE PORTÉE — et ce qu'elle ne fait PAS.
     *
     * La plus sombre des deux couleurs de socle, à faible opacité. Sur un
     * masque CLAIR (Brasserie, Atelier, Marché, Soleil) c'est l'encre, et
     * l'ombre décolle vraiment la carte de la pile. Sur un masque SOMBRE, la
     * plus sombre des deux EST le fond : l'ombre y devient invisible — la même
     * couleur sur elle-même. C'est assumé et sans artefact : en mode sombre,
     * c'est le liseré et le dégradé qui portent la séparation, exactement
     * comme `--cf-shadow-*` du résolveur, dont l'ombre s'efface pour la même
     * raison sur les mêmes directions.
     */
    ombre: luminance(p.ink) <= luminance(p.ground) ? p.ink : p.ground,
    /* Le couple `onAccent/accent` — le seul du dessin que le contrat prouve déjà. */
    tampon: p.onAccent,
  };
}

/** `d` d'un rectangle arrondi, dans le repère local. */
function cheminRectangle(r: Rectangle, rayon: number): string {
  const x = r.cx - r.largeur / 2;
  const y = r.cy - r.hauteur / 2;
  const k = Math.min(rayon, r.largeur / 2, r.hauteur / 2);
  return (
    `M ${x + k} ${y} H ${x + r.largeur - k} A ${k} ${k} 0 0 1 ${x + r.largeur} ${y + k}` +
    ` V ${y + r.hauteur - k} A ${k} ${k} 0 0 1 ${x + r.largeur - k} ${y + r.hauteur}` +
    ` H ${x + k} A ${k} ${k} 0 0 1 ${x} ${y + r.hauteur - k}` +
    ` V ${y + k} A ${k} ${k} 0 0 1 ${x + k} ${y} Z`
  );
}

const arrondi = (n: number): number => Math.round(n * 100) / 100;

/**
 * LE HALO — la lumière qui tombe sur le plan, derrière la pile.
 *
 * Il valait 0,22 sur tout le canevas, et regardé aux six directions c'était
 * l'écueil annoncé : sur Brasserie et sur Atelier, un rouge sourd étalé sur une
 * crème donne une AURÉOLE SALE, pas une lumière. Ramené à 0,12 et resserré
 * (r 0,62 au lieu de 0,85), il éclaire le coin d'où vient la lumière et laisse
 * le reste du fond à sa propre valeur.
 *
 * Extrait en fonction parce que les DEUX dessins l'emploient : la pile de
 * cartes et l'icône composée avec le logo. C'est ce halo, avec le fond, qui
 * fait que les deux restent de la même famille.
 */
function gradientHalo(c: CouleursIcone): string {
  return (
    `<radialGradient id="halo" cx="0.26" cy="0.18" r="0.62">` +
    `<stop offset="0" stop-color="${c.halo}" stop-opacity="0.12"/>` +
    `<stop offset="1" stop-color="${c.halo}" stop-opacity="0"/>` +
    `</radialGradient>`
  );
}

/**
 * Le dessin complet, en balisage SVG.
 *
 * AUCUNE ENTRÉE UTILISATEUR N'Y ENTRE : toutes les valeurs interpolées sont
 * des nombres calculés ici ou des hex déjà validés par `BrandSchema`
 * (`HexSchema`) puis, pour les dérivées, ré-encodés par `melanger` /
 * `ajusterJusquaAA`. C'est ce qui permet de se passer de l'échappement XML que
 * l'ancienne version devait faire sur le nom du restaurant.
 */
export function dessinerIconeCarte(brand: Brand, forme: FormeIcone): string {
  const c = couleursDe(brand);
  const k = echelle(forme);
  const rayonCarte = RAYON_CARTE[brand.shape] * CARTE_DESSUS.hauteur;
  const centre = TAILLE / 2;

  const dessus = cheminRectangle(CARTE_DESSUS, rayonCarte);
  const dessous = cheminRectangle(CARTE_DESSOUS, rayonCarte);

  const tampons = [-ECART_TAMPON, 0, ECART_TAMPON].map((dx, index) => {
    const cx = arrondi(CARTE_DESSUS.cx + dx);
    const cy = arrondi(CARTE_DESSUS.cy + DECALAGE_TAMPONS);
    /* Le troisième est un ANNEAU : c'est le palier qui reste à atteindre. */
    return index === 2
      ? `<circle cx="${cx}" cy="${cy}" r="${RAYON_TAMPON - TRAIT_TAMPON / 2}" fill="none" stroke="${c.tampon}" stroke-width="${TRAIT_TAMPON}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${RAYON_TAMPON}" fill="${c.tampon}"/>`;
  }).join("");

  /*
   * LE FOND. `masquable` remplit tout le carré — un lanceur qui rogne en
   * goutte ou en cercle ne doit jamais trouver de transparence. `plein` porte
   * sa propre tuile, arrondie selon la forme du masque.
   */
  const fond = forme === "masquable"
    ? `<rect width="${TAILLE}" height="${TAILLE}" fill="${c.fond}"/>`
    : `<rect width="${TAILLE}" height="${TAILLE}" rx="${arrondi(RAYON_TUILE[brand.shape] * TAILLE)}" fill="${c.fond}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TAILLE} ${TAILLE}" width="${TAILLE}" height="${TAILLE}" role="img">` +
    `<defs>` +
    gradientHalo(c) +
    /* La matière de la carte : éclairée en haut, ombrée en bas. */
    `<linearGradient id="carte" x1="0.1" y1="0" x2="0.85" y2="1">` +
    `<stop offset="0" stop-color="${c.hautDeCarte}"/>` +
    `<stop offset="1" stop-color="${c.basDeCarte}"/>` +
    `</linearGradient>` +
    `</defs>` +
    fond +
    `<rect width="${TAILLE}" height="${TAILLE}" fill="url(#halo)"${forme === "plein" ? ` rx="${arrondi(RAYON_TUILE[brand.shape] * TAILLE)}"` : ""}/>` +
    `<g transform="translate(${centre} ${centre}) rotate(${ANGLE}) scale(${arrondi(k)})">` +
    /*
     * LA CARTE DU DESSOUS — remplie ET cerclée.
     *
     * Le remplissage seul ne suffisait pas : sur Marché et sur Atelier, une
     * surface poussée vers l'encre reste, sur un fond presque blanc, un gris
     * si pâle que la pile se lisait comme une ombre floue plutôt que comme une
     * seconde carte. Le même liseré que la carte du dessus, à demi-opacité,
     * lui rend son BORD — et c'est le bord qui fait l'objet.
     */
    `<path d="${dessous}" fill="${c.dessous}" stroke="${c.liseré}" stroke-opacity="0.45" stroke-width="${TRAIT_CARTE * 0.75}"/>` +
    /* L'ombre portée : la même carte, décalée, dans la plus sombre des deux
       couleurs de socle. C'est elle qui DÉCOLLE la carte de la pile. */
    `<g transform="translate(0 ${DECALAGE_OMBRE})"><path d="${dessus}" fill="${c.ombre}" fill-opacity="0.28"/></g>` +
    `<path d="${dessus}" fill="url(#carte)" stroke="${c.liseré}" stroke-width="${TRAIT_CARTE}"/>` +
    tampons +
    `</g>` +
    `</svg>`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// L'ICÔNE COMPOSÉE AVEC LE LOGO DU RESTAURATEUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LE CÔTÉ DU CARRÉ OÙ LE LOGO S'INSCRIT, sur le canevas de 512.
 *
 * La zone sûre masquable est un CERCLE (r = 204,8) ; une image, elle, se pose
 * dans un rectangle. Le plus grand carré inscrit dans ce cercle a pour côté le
 * diamètre divisé par √2 — c'est de la géométrie, pas un réglage —, et on lui
 * applique le MÊME retrait de 4 % que `echelle("masquable")` : la spécification
 * donne le cercle comme une garantie, pas comme une cible à effleurer, et les
 * lanceurs qui rognent en goutte mordent un peu plus sur un des quatre côtés.
 *
 * Le résultat (≈ 278) a une demi-diagonale de ≈ 196,6 — exactement le rayon
 * qu'atteint déjà la pile de cartes. Les deux dessins occupent donc la même
 * empreinte, ce qui n'est pas une coïncidence : c'est la même contrainte.
 *
 * `meet` fait le reste : un logo plus large que haut ne remplit pas le carré,
 * il s'y CENTRE. Il ne peut donc, dans aucun cas, déborder de la zone sûre.
 */
export const COTE_LOGO_MASQUABLE: number = (TAILLE * RATIO_ZONE_SURE * 0.96) / Math.SQRT2;

/**
 * Les seuls `href` qu'on accepte d'incorporer.
 *
 * `data:` d'image RASTER — les trois formats que `detecterImage` reconnaît, et
 * pas un de plus : `image/svg+xml` est absent EXPRÈS, un SVG dans un SVG
 * rouvrirait scripts, feuilles de style et sous-ressources. Le corps est borné
 * à l'alphabet base64, donc aucun caractère de balisage ne peut s'y cacher.
 *
 * http(s) — pour le SEUL aperçu de l'administration, où le balisage est injecté
 * dans le document (`ApercuInstalle`) et non consommé comme image : là, et là
 * seulement, une adresse externe se charge. Servi comme icône, un SVG est en
 * mode statique sécurisé et ne charge aucune sous-ressource — c'est
 * précisément pourquoi la route, elle, incorpore les octets.
 *
 * `new URL` plutôt qu'une expression régulière sur le schéma : elle refuse
 * aussi les `javascript:` déguisés par des espaces ou des retours à la ligne,
 * que le contrat a déjà eu à repousser une fois (`marque.test.ts`).
 */
const DATA_URI_RASTER = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function hrefIncorporable(href: string): boolean {
  if (DATA_URI_RASTER.test(href)) return true;
  try {
    const protocole = new URL(href).protocol;
    return protocole === "http:" || protocole === "https:";
  } catch {
    return false;
  }
}

/** Les cinq caractères qui pourraient sortir d'un attribut XML. */
function echapperXml(valeur: string): string {
  return valeur.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string,
  );
}

/**
 * L'ICÔNE MASQUABLE COMPOSÉE AVEC LE LOGO — ou `null` si l'adresse est refusée.
 *
 * Trois couches seulement : le fond du masque sur TOUT le canevas (un lanceur
 * qui rogne en goutte ne doit jamais trouver de transparence), le halo, et le
 * logo ajusté dans la zone sûre. Pas de pile de cartes : voir l'en-tête du
 * fichier, § 4 — il n'y a pas de place pour les deux.
 *
 * `null` et non une exception : l'appelant a toujours un repli sous la main —
 * `dessinerIconeCarte(brand, "masquable")` —, et une icône de lanceur ne se
 * corrige jamais après l'installation. Mieux vaut notre dessin que rien.
 */
export function dessinerIconeLogo(brand: Brand, href: string): string | null {
  if (!hrefIncorporable(href)) return null;
  const c = couleursDe(brand);
  const cote = arrondi(COTE_LOGO_MASQUABLE);
  const coin = arrondi((TAILLE - COTE_LOGO_MASQUABLE) / 2);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TAILLE} ${TAILLE}" width="${TAILLE}" height="${TAILLE}" role="img">` +
    `<defs>` +
    gradientHalo(c) +
    `</defs>` +
    `<rect width="${TAILLE}" height="${TAILLE}" fill="${c.fond}"/>` +
    `<rect width="${TAILLE}" height="${TAILLE}" fill="url(#halo)"/>` +
    /*
     * `xMidYMid meet` : le logo est AJUSTÉ dans son carré, centré, jamais
     * recadré. C'est la règle que l'éditeur de marque applique déjà à ses
     * vignettes de dépôt, et l'inverse de ce que fait `object-cover`.
     *
     * `href` nu, sans `xlink:href` : le rendu des icônes de manifeste passe
     * par Blink, qui lit l'attribut SVG 2 depuis 2017. Doubler l'attribut
     * doublerait le poids du `data:` URI pour des moteurs que ce fichier ne
     * rencontre jamais.
     */
    `<image href="${echapperXml(href)}" x="${coin}" y="${coin}" width="${cote}" height="${cote}" preserveAspectRatio="xMidYMid meet"/>` +
    `</svg>`
  );
}
