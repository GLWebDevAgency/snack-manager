/**
 * Reconnaissance d'image PAR LES OCTETS, jamais par l'extension ni par le
 * Content-Type annoncé : les deux sont déclaratifs, et un fichier quelconque
 * renommé `logo.png` doit être refusé À L'ENTRÉE — pas découvert cassé sur
 * un ticket. La même fonction resert AU SERVICE : le type renvoyé au
 * navigateur vient des octets stockés, pas d'une métadonnée à synchroniser.
 *
 * Trois formats, et pas de SVG : un SVG peut embarquer du script, et un logo
 * servi sur la page de commande publique ne doit pas pouvoir en exécuter.
 *
 * ─── POURQUOI CE FICHIER EST DANS LE CONTRAT ───
 *
 * Il vivait dans `modules/tenants/`, à côté de la politique du logo, et c'était
 * juste tant qu'il n'y avait qu'UN seul dépôt de fichier dans toute l'API.
 * Trois lecteurs en ont besoin désormais, et ils ne sont pas dans le même
 * paquet : l'API (qui admet ou refuse à l'entrée, et qui rend le type au
 * navigateur au service), la reprise `backfill:medias` (qui doit inscrire le
 * type et l'empreinte des photos du pilote), et l'écran de dépôt, qui peut dire
 * « ce n'est pas une image » AVANT d'envoyer deux mégaoctets. Trois copies de
 * cette table de signatures finiraient par diverger sur le format qu'on emploie
 * le moins — et une divergence ici, c'est un fichier admis d'un côté, refusé de
 * l'autre, ou servi avec un type qu'il n'a pas.
 *
 * Écrit sur `Uint8Array` et non sur `Buffer` : le contrat est aussi lu par le
 * navigateur, où `Buffer` n'existe pas. Un `Buffer` EST un `Uint8Array`, les
 * appelants Node n'ont donc rien à convertir.
 *
 * La POLITIQUE (formats admis, taille, quota, clés d'objet) reste ailleurs :
 * ce fichier ne sait pas ce qu'est un logo ni ce qu'est une photo de plat.
 */
export type FormatImage = 'image/png' | 'image/jpeg' | 'image/webp';

/** Les quatre premiers octets, lus comme du latin-1 — « RIFF », « WEBP », « IHDR ». */
function marque(o: Uint8Array, debut: number, longueur: number): string {
  let s = '';
  for (let i = debut; i < debut + longueur && i < o.length; i += 1) {
    s += String.fromCharCode(o[i] as number);
  }
  return s;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detecterImage(octets: Uint8Array): FormatImage | null {
  if (octets.length < 12) return null;
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (PNG_SIGNATURE.every((b, i) => octets[i] === b)) return 'image/png';
  // JPEG : FF D8 FF
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg';
  // WebP : « RIFF » …taille… « WEBP »
  if (marque(octets, 0, 4) === 'RIFF' && marque(octets, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

/** Largeur et hauteur en pixels, lues dans l'en-tête du format. */
export type Dimensions = { largeur: number; hauteur: number };

/**
 * LES COTES, LUES DANS LES OCTETS — sans une seule dépendance.
 *
 * Les trois formats admis annoncent leur taille dans les premiers octets :
 * c'est de la lecture d'en-tête, pas du décodage d'image. Ajouter `sharp` ou
 * `image-size` pour ça ferait entrer un binaire natif (et sa chaîne de
 * compilation) dans une API qui ne transforme aucune image — précisément le
 * refus posé pour cette version.
 *
 * `null` quand l'en-tête ne se laisse pas lire : un WebP animé, un JPEG dont
 * le marqueur de trame arrive après ce qu'on parcourt, un fichier tronqué. Ce
 * n'est PAS une erreur — les cotes sont un confort d'écran (savoir qu'une
 * photo est trop petite pour un téléviseur), jamais une condition d'admission.
 * Un dépôt ne doit pas échouer parce qu'on n'a pas su compter des pixels.
 */
export function dimensionsImage(octets: Uint8Array): Dimensions | null {
  switch (detecterImage(octets)) {
    case 'image/png':
      return dimensionsPng(octets);
    case 'image/jpeg':
      return dimensionsJpeg(octets);
    case 'image/webp':
      return dimensionsWebp(octets);
    default:
      return null;
  }
}

/** Les lectures multi-octets, écrites une fois — `DataView` est universel. */
const vue = (o: Uint8Array) => new DataView(o.buffer, o.byteOffset, o.byteLength);

/** PNG : le bloc IHDR est TOUJOURS le premier, largeur et hauteur en tête. */
function dimensionsPng(o: Uint8Array): Dimensions | null {
  if (o.length < 24 || marque(o, 12, 4) !== 'IHDR') return null;
  const v = vue(o);
  return { largeur: v.getUint32(16, false), hauteur: v.getUint32(20, false) };
}

/**
 * JPEG : la taille vit dans le marqueur de TRAME (SOFn), qui arrive après un
 * nombre variable de segments (miniature Exif, tables de quantification…). On
 * saute donc de segment en segment par leur longueur déclarée — jamais en
 * cherchant un motif, qui se trouverait dans les données d'une miniature.
 */
function dimensionsJpeg(o: Uint8Array): Dimensions | null {
  const v = vue(o);
  let i = 2;
  while (i + 9 < o.length) {
    if (o[i] !== 0xff) return null; // Flux désynchronisé : on n'invente pas.
    let marqueur = o[i + 1] as number;
    // Les octets de bourrage 0xFF sont légaux entre deux marqueurs.
    while (marqueur === 0xff && i + 2 < o.length) {
      i += 1;
      marqueur = o[i + 1] as number;
    }
    // SOF0-3, SOF5-7, SOF9-11, SOF13-15 : toutes les trames, sauf les
    // marqueurs de redémarrage (D0-D7), DHT (C4), JPG (C8) et DAC (CC).
    const estTrame =
      marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur);
    if (estTrame) {
      return { largeur: v.getUint16(i + 7, false), hauteur: v.getUint16(i + 5, false) };
    }
    // SOS (DA) : les données compressées commencent, la trame ne viendra plus.
    if (marqueur === 0xda || marqueur === 0xd9) return null;
    const longueur = v.getUint16(i + 2, false);
    if (longueur < 2) return null;
    i += 2 + longueur;
  }
  return null;
}

/**
 * WebP : trois formes de charge sous le conteneur RIFF, et chacune range ses
 * cotes ailleurs. `VP8X` (étendu) porte la taille de TOILE, qui est celle qui
 * compte quand l'image est animée ou transparente.
 */
function dimensionsWebp(o: Uint8Array): Dimensions | null {
  const forme = marque(o, 12, 4);
  const v = vue(o);

  if (forme === 'VP8 ' && o.length >= 30) {
    // Code de synchronisation de la trame de clé : sans lui, ce n'est pas une
    // image fixe et les deux entiers qui suivent ne veulent rien dire.
    if (o[23] !== 0x9d || o[24] !== 0x01 || o[25] !== 0x2a) return null;
    return { largeur: v.getUint16(26, true) & 0x3fff, hauteur: v.getUint16(28, true) & 0x3fff };
  }

  if (forme === 'VP8L' && o.length >= 25) {
    if (o[20] !== 0x2f) return null;
    const bits = v.getUint32(21, true);
    return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
  }

  if (forme === 'VP8X' && o.length >= 30) {
    const lire24 = (i: number) => o[i]! | (o[i + 1]! << 8) | (o[i + 2]! << 16);
    return { largeur: lire24(24) + 1, hauteur: lire24(27) + 1 };
  }

  return null;
}
