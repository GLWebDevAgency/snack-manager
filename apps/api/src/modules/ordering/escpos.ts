/**
 * Encodeur ESC/POS maison — aucune dépendance npm.
 *
 * Pourquoi maison : les libs ESC/POS du marché embarquent une couche transport
 * (USB/série/réseau) dont on n'a pas besoin. Ici l'API se contente de PRODUIRE
 * le flux d'octets ; c'est le poste de caisse (ou un pont d'impression local)
 * qui l'envoie à l'imprimante. Un `Buffer` sans I/O reste testable et portable.
 *
 * Jeu de commandes couvert (Epson ESC/POS, compatible la quasi-totalité des
 * imprimantes thermiques 58/80 mm) :
 *   ESC @        (1B 40)        réinitialisation
 *   ESC t n      (1B 74 n)      table de caractères (19 = CP858, accents FR + €)
 *   ESC a n      (1B 61 n)      alignement   0 gauche · 1 centre · 2 droite
 *   ESC E n      (1B 45 n)      gras on/off
 *   ESC - n      (1B 2D n)      soulignement 0/1/2
 *   GS  ! n      (1D 21 n)      taille : n = (largeur-1)<<4 | (hauteur-1)
 *   ESC d n      (1B 64 n)      avance de n lignes
 *   GS  V 66 n   (1D 56 42 n)   coupe partielle après n points d'avance
 *   GS  V 65 n   (1D 56 41 n)   coupe complète après n points d'avance
 *
 * Encodage : le flux ESC/POS est en octets simples, pas en UTF-8. On sélectionne
 * la page de code 858 (latin occidental + €) et on convertit chaque caractère.
 * Les caractères hors table (typographie « ’ — … », emoji) sont translittérés
 * AVANT la mise en page, pour que 1 caractère affiché = 1 octet et que les
 * colonnes restent alignées.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Page de code 858 : CP850 + le symbole € en 0xD5. */
const CP858_CODEPAGE = 19;

/** Latin-1 utile en français → octet CP858. */
const CP858: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, '×': 0x9e, 'ƒ': 0x9f,
  'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '®': 0xa9, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
  'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, '¢': 0xbd, '¥': 0xbe,
  'ã': 0xc6, 'Ã': 0xc7, '¤': 0xcf,
  'ð': 0xd0, 'Ð': 0xd1, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, '€': 0xd5, 'Í': 0xd6, 'Î': 0xd7,
  'Ï': 0xd8, '¦': 0xdd, 'Ì': 0xde,
  'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'µ': 0xe6, 'þ': 0xe7,
  'Þ': 0xe8, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, 'ý': 0xec, 'Ý': 0xed, '¯': 0xee, '´': 0xef,
  '±': 0xf1, '¾': 0xf2, '¶': 0xf3, '§': 0xf4, '÷': 0xf6, '¸': 0xf7, '°': 0xf8, '¨': 0xf9,
  '·': 0xfa, '¹': 0xfb, '³': 0xfc, '²': 0xfd,
};

/** Caractères absents de CP858 → équivalent imprimable (appliqué en premier). */
const TRANSLITERATIONS: [RegExp, string][] = [
  [/[‘’‛]/g, "'"], //  ’ ‘ → '
  [/[“”„]/g, '"'],
  [/[–—−]/g, '-'], //  – — − → -
  [/…/g, '...'],
  [/[    ]/g, ' '], // espaces insécables → espace simple
  [/œ/g, 'oe'],
  [/Œ/g, 'OE'],
  [/•/g, '*'],
  [/✓/g, 'v'],
];

const UNPRINTABLE = 0x3f; // « ? »

/**
 * Ramène un texte à un contenu 1 caractère = 1 octet CP858.
 * Indispensable AVANT tout calcul de largeur de colonne.
 */
export function sanitize(input: string): string {
  let out = input.normalize('NFC');
  for (const [pattern, replacement] of TRANSLITERATIONS) out = out.replace(pattern, replacement);
  let result = '';
  for (const char of out) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n' || char === '\t') result += char;
    else if (code >= 0x20 && code <= 0x7e) result += char;
    else if (char in CP858) result += char;
    else result += '?'; // emoji, alphabets non latins…
  }
  return result;
}

/** Texte déjà assaini → octets CP858. */
function encodeCp858(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (char === '\n') bytes.push(0x0a);
    else if (char === '\t') bytes.push(0x09);
    else bytes.push(CP858[char] ?? UNPRINTABLE);
  }
  return Buffer.from(bytes);
}

export type Align = 'left' | 'center' | 'right';
export type CutMode = 'partial' | 'full' | 'none';

const ALIGN_CODES: Record<Align, number> = { left: 0, center: 1, right: 2 };

/**
 * Constructeur de flux ESC/POS.
 * `width` = nombre de caractères par ligne en taille normale
 * (32 pour un rouleau 58 mm, 42 ou 48 pour un 80 mm).
 */
export class EscPosBuilder {
  private readonly chunks: Buffer[] = [];

  constructor(private readonly width = 42) {}

  /** Largeur utile en caractères (utile pour composer des colonnes). */
  get lineWidth(): number {
    return this.width;
  }

  private push(...bytes: number[]): this {
    this.chunks.push(Buffer.from(bytes));
    return this;
  }

  /** ESC @ + sélection de la page de code : à envoyer en tête de chaque ticket. */
  init(): this {
    return this.push(ESC, 0x40).push(ESC, 0x74, CP858_CODEPAGE);
  }

  align(align: Align): this {
    return this.push(ESC, 0x61, ALIGN_CODES[align]);
  }

  bold(on: boolean): this {
    return this.push(ESC, 0x45, on ? 1 : 0);
  }

  underline(on: boolean): this {
    return this.push(ESC, 0x2d, on ? 1 : 0);
  }

  /** Multiplicateurs 1–8. `size(2, 3)` = double largeur, triple hauteur. */
  size(width = 1, height = 1): this {
    const w = Math.min(8, Math.max(1, Math.round(width))) - 1;
    const h = Math.min(8, Math.max(1, Math.round(height))) - 1;
    return this.push(GS, 0x21, (w << 4) | h);
  }

  /** Retour à la casse normale : taille 1×1, ni gras ni souligné, à gauche. */
  reset(): this {
    return this.size(1, 1).bold(false).underline(false).align('left');
  }

  /** Une ligne de texte (assainie) + saut de ligne. */
  line(text = ''): this {
    this.chunks.push(encodeCp858(`${sanitize(text)}\n`));
    return this;
  }

  /**
   * Texte long replié sur `width` (ou `width / scale` en caractères agrandis).
   * `indent` préfixe uniquement les lignes de continuation.
   */
  wrapped(text: string, scale = 1, indent = ''): this {
    const limit = Math.max(8, Math.floor(this.width / scale));
    const chunks = wrapText(sanitize(text), limit);
    chunks.forEach((chunk, i) => this.line(i === 0 ? chunk : `${indent}${chunk}`));
    return this;
  }

  /**
   * Deux colonnes justifiées sur la largeur : libellé à gauche, montant à droite.
   * Le libellé est tronqué plutôt que de casser l'alignement du montant.
   */
  columns(left: string, right: string, scale = 1): this {
    const limit = Math.max(8, Math.floor(this.width / scale));
    const rightText = sanitize(right);
    const room = Math.max(0, limit - rightText.length - 1);
    let leftText = sanitize(left);
    if (leftText.length > room) leftText = leftText.slice(0, room).trimEnd();
    const gap = Math.max(1, limit - leftText.length - rightText.length);
    return this.line(`${leftText}${' '.repeat(gap)}${rightText}`);
  }

  /**
   * Comme `columns`, mais le libellé trop long se poursuit sur les lignes
   * suivantes (indentées) au lieu d'être coupé — usage courant des tickets de
   * caisse : le montant reste sur la première ligne de l'article.
   */
  columnsWrap(left: string, right: string, indent = '  ', scale = 1): this {
    const limit = Math.max(8, Math.floor(this.width / scale));
    const rightText = sanitize(right);
    const room = Math.max(4, limit - rightText.length - 1);
    const [first = '', ...rest] = wrapText(sanitize(left), room);
    const gap = Math.max(1, limit - first.length - rightText.length);
    this.line(`${first}${' '.repeat(gap)}${rightText}`);
    for (const chunk of rest) this.line(`${indent}${chunk}`);
    return this;
  }

  /** Filet pleine largeur. */
  rule(char = '-'): this {
    const c = sanitize(char).charAt(0) || '-';
    return this.line(c.repeat(this.width));
  }

  feed(lines = 1): this {
    return this.push(ESC, 0x64, Math.min(255, Math.max(0, Math.round(lines))));
  }

  /** Coupe du papier après une petite avance (sinon la coupe mange le texte). */
  cut(mode: CutMode = 'partial'): this {
    if (mode === 'none') return this.feed(2);
    this.feed(4);
    return this.push(GS, 0x56, mode === 'full' ? 0x41 : 0x42, 0x00);
  }

  /** Impulsion tiroir-caisse (connecteur 2, 100 ms) — optionnelle. */
  openDrawer(): this {
    return this.push(ESC, 0x70, 0x00, 0x19, 0x19);
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Repli de texte sur `limit` caractères, sans couper les mots quand c'est possible. */
export function wrapText(text: string, limit: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + 1 + word.length <= limit) {
        current += ` ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
      // Mot plus long que la ligne (URL, référence) : découpe brute.
      while (current.length > limit) {
        lines.push(current.slice(0, limit));
        current = current.slice(limit);
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}
