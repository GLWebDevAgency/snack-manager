import {
  INVOICE_LEGAL_PLACEHOLDER,
  formatEuros,
  formatFrDate,
  type InvoiceLegalGap,
  type InvoiceParty,
} from '@sm/contracts';
import {
  CONTENT_W,
  Content,
  MARGIN,
  PAGE_H,
  RIGHT,
  assemble,
  or,
  partyLines,
  wrap,
} from './invoice-pdf';

/**
 * LE DEVIS — le document qui matérialise l'étape « Proposition » du pipeline.
 *
 * Il partage TOUT son squelette avec la facture (`invoice-pdf.ts`) : mêmes
 * chasses, mêmes encres, même identité d'émetteur venue de l'environnement,
 * mêmes emplacements `[À COMPLÉTER]` pour les mentions absentes. C'est voulu :
 * le devis d'aujourd'hui devient la facture de dans trente jours, et les deux
 * documents doivent se ressembler comme deux pièces d'une même maison.
 *
 * Ce qui le distingue d'une facture, et que le rendu porte : PLUSIEURS lignes
 * (l'abonnement, le module, la mise en service) chacune avec sa récurrence ;
 * une VALIDITÉ au lieu d'une échéance ; et le bloc « Bon pour accord » — un
 * devis se signe, il ne se règle pas.
 */

export type DevisLigne = {
  designation: string;
  /** « par mois », « la première année », « une fois » — imprimé tel quel. */
  recurrence: string;
  montantHtCents: number;
};

export type DevisDocument = {
  /** `DEV-AAAAMMJJ-xxxx` — reproductible, sans séquence fiscale : un devis n'en exige pas. */
  number: string;
  issuedAt: string;
  /** Fin de validité — trente jours, l'usage. */
  validUntil: string;
  issuer: InvoiceParty;
  customer: InvoiceParty;
  /** Contact du prospect — un lead n'a pas d'adresse de siège, il a un humain. */
  contactLine: string;
  lignes: DevisLigne[];
  vatRatePercent: number;
  /** Conditions, dans l'ordre d'impression — essai, validité, engagement. */
  conditions: readonly string[];
  gaps: readonly InvoiceLegalGap[];
};

const vatOf = (htCents: number, rate: number): number => Math.round((htCents * rate) / 100);

export function renderDevisPdf(doc: DevisDocument): Buffer {
  const c = new Content();
  let y = PAGE_H - MARGIN;

  // ── En-tête : émetteur à gauche, pièce à droite — même grille que la facture ──
  for (const line of wrap(or(doc.issuer.name), 14, true, 290)) {
    c.text(line, MARGIN, y, 14, true);
    y -= 16;
  }
  for (const line of partyLines(doc.issuer, 'issuer')) {
    c.text(line, MARGIN, y, 8.5, false, 'mut');
    y -= 11;
  }

  const headRight = PAGE_H - MARGIN;
  c.text('DEVIS', 360, headRight, 22, true);
  c.text(`N° ${doc.number}`, 360, headRight - 22, 11, true);
  c.text(`Émis le ${formatFrDate(doc.issuedAt)}`, 360, headRight - 38, 9, false, 'mut');
  c.text(`Valable jusqu'au ${formatFrDate(doc.validUntil)}`, 360, headRight - 51, 9, false, 'mut');

  y = Math.min(y, headRight - 70);
  c.rule(MARGIN, y, CONTENT_W);
  y -= 24;

  // ── Prospect ──
  c.text('PROPOSÉ À', MARGIN, y, 8, true, 'mut');
  y -= 15;
  for (const line of wrap(or(doc.customer.name), 12, true, CONTENT_W)) {
    c.text(line, MARGIN, y, 12, true);
    y -= 14;
  }
  for (const line of partyLines(doc.customer, 'customer')) {
    c.text(line, MARGIN, y, 9, false, 'mut');
    y -= 12;
  }
  if (doc.contactLine) {
    c.text(doc.contactLine, MARGIN, y, 9, false, 'mut');
    y -= 12;
  }

  y -= 14;
  c.rule(MARGIN, y, CONTENT_W);
  y -= 20;

  // ── Lignes ──
  c.text('DÉSIGNATION', MARGIN, y, 8, true, 'mut');
  c.text('RÉCURRENCE', 320, y, 8, true, 'mut');
  c.rightLabel('MONTANT HT', RIGHT, y, 8, true, 'mut');
  y -= 8;
  c.rule(MARGIN, y, CONTENT_W, 0.9, 0.35);
  y -= 18;

  for (const ligne of doc.lignes) {
    const lines = wrap(ligne.designation, 10, false, 250);
    for (const [index, line] of lines.entries()) {
      c.text(line, MARGIN, y - index * 12, 10);
    }
    c.text(ligne.recurrence, 320, y, 10, false, 'mut');
    c.money(formatEuros(ligne.montantHtCents), RIGHT, y, 10);
    y -= Math.max(lines.length * 12, 12) + 8;
  }

  y -= 4;
  c.rule(MARGIN, y, CONTENT_W);
  y -= 22;

  // ── Totaux, PAR RÉCURRENCE : additionner un « par mois » et un « une fois »
  // dans un même total fabriquerait un chiffre qui ne correspond à aucun
  // versement réel — chaque récurrence a ses trois lignes HT / TVA / TTC. ──
  const groupes = [...new Set(doc.lignes.map((l) => l.recurrence))];
  for (const recurrence of groupes) {
    const ht = doc.lignes
      .filter((l) => l.recurrence === recurrence)
      .reduce((somme, l) => somme + l.montantHtCents, 0);
    const tva = vatOf(ht, doc.vatRatePercent);

    c.text(`Total ${recurrence}`, 270, y, 9, true, 'mut');
    y -= 14;
    const lignes: [string, number, boolean][] = [
      ['Hors taxes', ht, false],
      [`TVA ${doc.vatRatePercent} %`, tva, false],
      ['Toutes taxes comprises', ht + tva, true],
    ];
    for (const [label, cents, strong] of lignes) {
      c.text(label, 270, y, strong ? 10.5 : 9.5, strong, strong ? 'ink' : 'mut');
      c.money(formatEuros(cents), RIGHT, y, strong ? 11.5 : 10, strong);
      y -= strong ? 18 : 15;
    }
    y -= 6;
  }

  // ── Conditions ──
  y -= 4;
  for (const mention of doc.conditions) {
    for (const line of wrap(mention, 8.5, false, CONTENT_W)) {
      c.text(line, MARGIN, y, 8.5, false, 'mut');
      y -= 11;
    }
    y -= 2;
  }

  // ── Bon pour accord — la raison d'être du document ──
  y -= 14;
  c.rule(MARGIN, y, CONTENT_W);
  y -= 20;
  c.text('BON POUR ACCORD', MARGIN, y, 10, true);
  c.text('Date :', MARGIN, y - 18, 9, false, 'mut');
  c.text('Nom et qualité du signataire :', 170, y - 18, 9, false, 'mut');
  c.text('Signature et cachet :', 400, y - 18, 9, false, 'mut');

  // ── Avertissement, s'il manque des mentions ──
  if (doc.gaps.length > 0) {
    const avis = `Mentions à compléter (${doc.gaps.length}) : ${doc.gaps.map((g) => g.label).join(' · ')}.`;
    let ay = y - 52;
    for (const line of wrap(avis, 8, true, CONTENT_W)) {
      c.text(line, MARGIN, ay, 8, true, 'mut');
      ay -= 10;
    }
  }

  // ── Pied de page ──
  c.rule(MARGIN, MARGIN + 18, CONTENT_W);
  c.text(
    `Devis ${doc.number} — ${or(doc.issuer.name)} · SIRET ${
      doc.issuer.siret ?? INVOICE_LEGAL_PLACEHOLDER
    }`,
    MARGIN,
    MARGIN,
    7.5,
    false,
    'mut',
  );

  return assemble(c.buffer(), `Devis ${doc.number}`);
}
