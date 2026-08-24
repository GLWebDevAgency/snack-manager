import {
  INVOICE_LEGAL_PLACEHOLDER,
  formatEuros,
  formatFrDate,
  type InvoiceDocument,
  type InvoiceParty,
} from '@sm/contracts';

/**
 * LA FACTURE, EN PDF, ÉCRITE À LA MAIN.
 *
 * ─── POURQUOI PAS UNE BIBLIOTHÈQUE ───
 *
 * Un PDF d'une page, sans image ni police embarquée, tient dans deux cents
 * lignes d'opérateurs standard. Les bibliothèques du domaine (pdfkit,
 * puppeteer, wkhtmltopdf) apportent respectivement un moteur de flux, un
 * navigateur complet de 300 Mo et un binaire système — pour un document qu'un
 * restaurateur télécharge deux fois par an. Le navigateur, en particulier,
 * transformerait une dépendance de rendu en dépendance de DÉPLOIEMENT : il
 * faudrait l'installer dans l'image Railway et le maintenir à jour, pour une
 * surface d'attaque considérable.
 *
 * ─── CE QUE CE FICHIER NE DÉCIDE PAS ───
 *
 * Rien du contenu. Les montants, la ventilation de TVA, les mentions légales et
 * la liste de ce qui manque sont assemblés et vérifiés par
 * `buildInvoiceDocument` (@sm/contracts). Ici on met en page, et c'est tout :
 * un second rendu (courriel, archive) partirait du MÊME document et dirait donc
 * exactement la même chose. Sur une pièce comptable, deux versions qui divergent
 * d'un centime, c'est un litige.
 *
 * ─── CE QUE CE DOCUMENT NE PRÉTEND PAS ÊTRE ───
 *
 * Il PORTE les mentions énumérées par le Code de commerce et le CGI. Ce n'est
 * pas la même chose qu'être CONFORME, et rien ici — pas une ligne de texte
 * imprimée, pas un nom de fonction — ne doit laisser croire le contraire. La
 * validation d'une facture appartient à un expert-comptable ; personne dans ce
 * dépôt n'en est un. Ce que le code garantit s'arrête à : les mentions
 * attendues figurent, celles qui manquent se voient.
 *
 * ─── ACCENTS ───
 *
 * Les polices standard PDF sont déclarées en `WinAnsiEncoding` (CP1252), qui
 * couvre tout le français — é, è, ç, à, œ excepté, ainsi que « », l'apostrophe
 * typographique et le symbole €. Le texte est donc converti octet par octet
 * vers CP1252 : un PDF écrit en UTF-8 afficherait « facturÃ© ».
 */

// ─── Géométrie (A4, en points typographiques) ───

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARGIN = 56;
export const RIGHT = PAGE_W - MARGIN;
export const CONTENT_W = RIGHT - MARGIN;

// ─── Conversion du texte vers CP1252 ───

/**
 * Les seize caractères de CP1252 qui ne sont pas au même point de code
 * qu'en Unicode (plage 0x80–0x9F). Sans cette table, l'apostrophe
 * typographique et le symbole € — les deux plus fréquents de nos libellés —
 * sortiraient en « ? ».
 */
const CP1252_HIGH: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
  // Caractères typographiques absents de CP1252, ramenés à leur équivalent
  // imprimable. L'espace fine insécable des milliers en fait partie : sans
  // cette ligne, « 1 390,00 € » sortirait « 1?390,00 € » — sur un montant.
  ' ': 0x20,
  ' ': 0x20,
  '−': 0x2d,
};

/** Texte → octets CP1252. Un caractère hors jeu devient « ? », jamais un carré. */
function toCp1252(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const mapped = CP1252_HIGH[char];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    const code = char.codePointAt(0) ?? 63;
    out.push(code <= 0xff ? code : 63);
  }
  return out;
}

/** Chaîne PDF littérale : parenthèses et antislash échappés, octets CP1252. */
function pdfText(text: string): string {
  return toCp1252(text)
    .map((byte) => {
      if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
        return `\\${String.fromCharCode(byte)}`;
      }
      return String.fromCharCode(byte);
    })
    .join('');
}

// ─── Largeurs ───

/**
 * Largeur EXACTE d'un montant, en unités de police (1/1000 de cadratin).
 *
 * Helvetica et Helvetica-Bold partagent les mêmes chasses sur les seuls
 * caractères qu'un montant contient : chiffres 556, virgule 278, espace 278,
 * € 556, signe moins 333. L'alignement à droite de la colonne « Montant » est
 * donc au point près — et il doit l'être : une colonne de montants qui ondule
 * est le premier signe qu'une facture a été bricolée.
 */
const MONEY_WIDTHS: Record<string, number> = {
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556,
  '5': 556, '6': 556, '7': 556, '8': 556, '9': 556,
  ',': 278, '.': 278, ' ': 278, ' ': 278, ' ': 278, '€': 556, '-': 333, '−': 333,
};

function moneyWidth(text: string, size: number): number {
  let total = 0;
  for (const char of text) total += MONEY_WIDTHS[char] ?? 556;
  return (total * size) / 1000;
}

/**
 * Largeur APPROCHÉE d'un texte courant, par classes de chasse.
 *
 * Elle ne sert qu'à décider où couper une ligne de mentions légales. Une table
 * AFM complète (deux fois deux cent cinquante glyphes) donnerait le point
 * exact, pour un gain invisible : une ligne de bas de page coupée deux
 * caractères trop tôt reste une ligne juste.
 */
function approxWidth(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const char of text) {
    if ('iljtfrI.,;:!|\'’ ()[]'.includes(char)) units += 280;
    else if ('mwMW'.includes(char)) units += 880;
    else if (char >= '0' && char <= '9') units += 556;
    else if (char === char.toUpperCase() && char !== char.toLowerCase()) units += 690;
    else units += 545;
  }
  return (units * size * (bold ? 1.06 : 1)) / 1000;
}

/** Découpe un paragraphe en lignes qui tiennent dans `maxWidth`. */
export function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (approxWidth(candidate, size, bold) <= maxWidth || current === '') current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

// ─── Flux de contenu ───

type Ink = 'ink' | 'mut';

/** Encre : noir pour ce qui engage, gris pour ce qui accompagne. */
const INKS: Record<Ink, string> = { ink: '0.09 0.08 0.06 rg', mut: '0.42 0.40 0.36 rg' };

export class Content {
  private readonly ops: string[] = [];

  text(value: string, x: number, y: number, size: number, bold = false, ink: Ink = 'ink'): void {
    this.ops.push(
      `${INKS[ink]}`,
      'BT',
      `/${bold ? 'F2' : 'F1'} ${size} Tf`,
      `${x.toFixed(2)} ${y.toFixed(2)} Td`,
      `(${pdfText(value)}) Tj`,
      'ET',
    );
  }

  /** Texte calé à DROITE de `right` — réservé aux montants (chasse exacte). */
  money(value: string, right: number, y: number, size: number, bold = false, ink: Ink = 'ink'): void {
    this.text(value, right - moneyWidth(value, size), y, size, bold, ink);
  }

  /** Libellé calé à droite — chasse approchée, suffisante pour un intitulé. */
  rightLabel(value: string, right: number, y: number, size: number, bold = false, ink: Ink = 'ink'): void {
    this.text(value, right - approxWidth(value, size, bold), y, size, bold, ink);
  }

  rule(x: number, y: number, width: number, thickness = 0.6, grey = 0.78): void {
    this.ops.push(
      `${grey} ${grey} ${grey} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${thickness} re f`,
    );
  }

  buffer(): Buffer {
    return Buffer.from(this.ops.join('\n'), 'latin1');
  }
}

// ─── Assemblage du fichier ───

/**
 * Ce qui s'imprime quand la base ne porte pas la mention.
 *
 * Le `hint` précise CE QUI manque quand l'emplacement se lit hors contexte
 * (« SIRET : [À COMPLÉTER] » se suffit, un titre isolé non). Il reste vide
 * partout où le libellé voisin le dit déjà : un emplacement bavard déborderait
 * de sa colonne et recouvrirait le bloc d'à côté.
 */
export const or = (value: string | null, hint = ''): string => {
  if (value && value.trim() !== '') return value;
  return hint === '' ? INVOICE_LEGAL_PLACEHOLDER : `${INVOICE_LEGAL_PLACEHOLDER} ${hint}`;
};

/**
 * Bloc d'identité d'une partie, ligne par ligne — les vides sont sautés.
 *
 * L'ÉMETTEUR et le CLIENT ne sont pas traités pareil, et ce n'est pas une
 * asymétrie de mise en page. Les mentions de l'émetteur sont OBLIGATOIRES :
 * absentes, elles s'impriment en emplacement vide, parce que leur absence est
 * un défaut de la facture. Celles du client sont FACULTATIVES — c'est le SIRET
 * de celui qui facture que la loi exige — et s'impriment donc seulement quand
 * il nous les a données : un « SIRET : [À COMPLÉTER] » sous le nom du
 * restaurant lui ferait croire qu'il a mal fait quelque chose.
 */
export function partyLines(party: InvoiceParty, required: 'issuer' | 'customer'): string[] {
  const lines: string[] = [];
  if (party.legalForm) lines.push(party.legalForm);
  lines.push(or(party.address, '— adresse postale'));
  if (required === 'issuer') {
    lines.push(`SIRET : ${or(party.siret)}`);
    lines.push(`TVA intracommunautaire : ${or(party.vatNumber)}`);
    if (party.rcs) lines.push(party.rcs);
    const contact = [party.email, party.phone].filter(Boolean).join(' · ');
    if (contact) lines.push(contact);
  } else {
    if (party.siret) lines.push(`SIRET : ${party.siret}`);
    if (party.vatNumber) lines.push(`TVA intracommunautaire : ${party.vatNumber}`);
  }
  return lines;
}

/**
 * Rend le document en PDF d'une page.
 *
 * `Buffer` et non flux : la pièce fait quelques kilo-octets, la longueur exacte
 * est nécessaire pour l'en-tête `Content-Length` du téléchargement, et un flux
 * n'apporterait qu'un enchevêtrement de rappels.
 */
export function renderInvoicePdf(doc: InvoiceDocument): Buffer {
  const c = new Content();
  let y = PAGE_H - MARGIN;

  // ── En-tête : émetteur à gauche, pièce à droite ──
  // La colonne de gauche s'arrête à 290 pt : au-delà, la dénomination viendrait
  // se poser SOUS le mot « FACTURE ». Une raison sociale longue passe donc à la
  // ligne plutôt que de recouvrir le numéro de pièce.
  for (const line of wrap(or(doc.issuer.name), 14, true, 290)) {
    c.text(line, MARGIN, y, 14, true);
    y -= 16;
  }
  for (const line of partyLines(doc.issuer, 'issuer')) {
    c.text(line, MARGIN, y, 8.5, false, 'mut');
    y -= 11;
  }

  const headRight = PAGE_H - MARGIN;
  c.text('FACTURE', 360, headRight, 22, true);
  c.text(`N° ${doc.number}`, 360, headRight - 22, 11, true);
  c.text(
    `Émise le ${doc.issuedAt ? formatFrDate(doc.issuedAt) : INVOICE_LEGAL_PLACEHOLDER}`,
    360,
    headRight - 38,
    9,
    false,
    'mut',
  );
  c.text(`Échéance le ${formatFrDate(doc.dueAt)}`, 360, headRight - 51, 9, false, 'mut');
  c.text(`Statut : ${doc.statusLabel}`, 360, headRight - 64, 9, false, 'mut');

  y = Math.min(y, headRight - 82);
  c.rule(MARGIN, y, CONTENT_W);
  y -= 24;

  // ── Client ──
  c.text('FACTURÉ À', MARGIN, y, 8, true, 'mut');
  y -= 15;
  for (const line of wrap(or(doc.customer.name), 12, true, CONTENT_W)) {
    c.text(line, MARGIN, y, 12, true);
    y -= 14;
  }
  for (const line of partyLines(doc.customer, 'customer')) {
    c.text(line, MARGIN, y, 9, false, 'mut');
    y -= 12;
  }

  y -= 14;
  c.rule(MARGIN, y, CONTENT_W);
  y -= 20;

  // ── Ligne de prestation ──
  c.text('DÉSIGNATION', MARGIN, y, 8, true, 'mut');
  c.text('PÉRIODE', 330, y, 8, true, 'mut');
  c.rightLabel('MONTANT HT', RIGHT, y, 8, true, 'mut');
  y -= 8;
  c.rule(MARGIN, y, CONTENT_W, 0.9, 0.35);
  y -= 18;

  for (const [index, line] of wrap(doc.designation, 10, false, 260).entries()) {
    c.text(line, MARGIN, y - index * 12, 10);
  }
  c.text(doc.periodLabel, 330, y, 10, false, 'mut');
  // La colonne « Montant » d'une ligne de prestation s'écrit HORS TAXES : c'est
  // la base sur laquelle la TVA du bas est calculée, et une ligne en TTC
  // au-dessus d'un « Total hors taxes » plus petit se lit comme une remise.
  c.money(formatEuros(doc.totals.htCents), RIGHT, y, 10);
  y -= Math.max(wrap(doc.designation, 10, false, 260).length * 12, 12) + 10;

  c.rule(MARGIN, y, CONTENT_W);
  y -= 22;

  // ── Totaux : HT, TVA, TTC — les trois lignes, toujours ──
  // Le libellé porte déjà « hors taxes » / « TVA » / « toutes taxes comprises » :
  // l'emplacement reste donc nu, sinon il chevaucherait sa propre étiquette.
  const money = (cents: number | null): string =>
    cents === null ? INVOICE_LEGAL_PLACEHOLDER : formatEuros(cents);

  // `mention` porte déjà le mot « TVA » et le taux — « TVA 20 % », ou la
  // formule de franchise en base. L'envelopper dans un second « TVA (…) »
  // imprimait « TVA (TVA 20 %) » : sur une ligne d'assiette imposable, un
  // bégaiement suffit à faire douter du reste du document.
  const totals: [string, string, boolean][] = [
    ['Total hors taxes', money(doc.vat.baseCents), false],
    [
      doc.vat.ratePercent === null ? `TVA — taux ${INVOICE_LEGAL_PLACEHOLDER}` : doc.vat.mention,
      money(doc.vat.vatCents),
      false,
    ],
    ['Total toutes taxes comprises', money(doc.vat.totalCents), true],
  ];

  for (const [label, value, strong] of totals) {
    c.text(label, 270, y, strong ? 11 : 9.5, strong, strong ? 'ink' : 'mut');
    if (value === INVOICE_LEGAL_PLACEHOLDER) c.rightLabel(value, RIGHT, y, 8.5, false, 'mut');
    else c.money(value, RIGHT, y, strong ? 12 : 10, strong);
    y -= strong ? 20 : 16;
  }

  // Le montant réellement facturé, sous son vrai nom, tant que le régime de TVA
  // n'est pas déclaré : c'est la seule somme dont on soit certain. Le cas ne
  // devrait plus se produire — toute pièce porte son régime, et les anciennes
  // ont un défaut documenté — mais la ligne reste : le jour où l'invariante
  // céderait, mieux vaut une facture qui le dit qu'une facture muette.
  if (!doc.vat.known) {
    c.text(
      `Montant facturé : ${formatEuros(doc.amountCents)} — la ventilation hors taxes / TVA reste à compléter.`,
      MARGIN,
      y,
      8.5,
      false,
      'mut',
    );
    y -= 16;
  }

  // ── Règlement ──
  y -= 8;
  // TOUTES TAXES COMPRISES : c'est la somme que le client vire. L'annoncer hors
  // taxes ferait arriver un virement inférieur d'un cinquième, et une facture
  // resterait éternellement « partiellement réglée » pour une raison que
  // personne ne comprendrait.
  const paid =
    doc.status === 'payee'
      ? `Facture réglée${doc.paidAt ? ` le ${formatFrDate(doc.paidAt)}` : ''}${doc.methodLabel ? ` par ${doc.methodLabel.toLowerCase()}` : ''}.`
      : doc.status === 'annulee'
        ? `Facture annulée${doc.cancelReason ? ` — ${doc.cancelReason}` : ''}. Aucun règlement n’est dû.`
        : `Reste à régler : ${doc.totals.ttcLabel} TTC.`;
  c.text(paid, MARGIN, y, 10, true);
  y -= 18;

  for (const mention of doc.settlement) {
    for (const line of wrap(mention, 8.5, false, CONTENT_W)) {
      c.text(line, MARGIN, y, 8.5, false, 'mut');
      y -= 11;
    }
    y -= 2;
  }

  // ── Avertissement, s'il manque des mentions ──
  if (doc.gaps.length > 0) {
    y -= 6;
    const avis = `Mentions obligatoires à compléter (${doc.gaps.length}) : ${doc.gaps.map((g) => g.label).join(' · ')}.`;
    for (const line of wrap(avis, 8, true, CONTENT_W)) {
      c.text(line, MARGIN, y, 8, true, 'mut');
      y -= 10;
    }
  }

  // ── Pied de page ──
  c.rule(MARGIN, MARGIN + 18, CONTENT_W);
  c.text(
    `Facture ${doc.number} — ${or(doc.issuer.name)} · SIRET ${or(doc.issuer.siret)}`,
    MARGIN,
    MARGIN,
    7.5,
    false,
    'mut',
  );

  return assemble(c.buffer(), `Facture ${doc.number}`);
}

/** Objets, table de références croisées, remorque — le squelette d'un PDF 1.4. */
export function assemble(stream: Buffer, title: string): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];

  const push = (value: Buffer | string): void => {
    const buf = typeof value === 'string' ? Buffer.from(value, 'latin1') : value;
    chunks.push(buf);
    offset += buf.length;
  };
  const object = (id: number, body: Buffer | string): void => {
    offsets[id] = offset;
    push(`${id} 0 obj\n`);
    push(body);
    push('\nendobj\n');
  };

  // Le commentaire binaire annonce aux outils que le fichier n'est pas du texte.
  push('%PDF-1.4\n');
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
  );

  offsets[4] = offset;
  push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n`);
  push(stream);
  push('\nendstream\nendobj\n');

  object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  object(7, `<< /Title (${pdfText(title)}) /Producer (Snack Manager) >>`);

  const count = 8;
  const xref = offset;
  push(`xref\n0 ${count}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < count; id += 1) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
