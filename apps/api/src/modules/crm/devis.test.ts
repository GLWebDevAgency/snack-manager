import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { EMPTY_PARTY, type InvoiceParty } from '@sm/contracts';
import { renderDevisPdf } from '../billing/devis-pdf';
import { buildDevisDocument } from './devis.service';

/**
 * Le devis dit l'offre, toute l'offre, rien que l'offre : les montants
 * viennent de la grille, la note interne ne s'imprime jamais, et une identité
 * d'émetteur absente ressort en manque déclaré — pas en mention inventée.
 */

const NOW = new Date('2026-08-24T12:00:00.000Z');
const LEAD = {
  _id: new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b8c'),
  restaurantName: 'Chez Nicolas',
  contact: { name: 'Nicolas', phone: '02 32 00 00 00', email: 'nicolas@exemple.fr' },
};
const ISSUER: InvoiceParty = {
  ...EMPTY_PARTY,
  name: 'GLWebDevAgency',
  address: '1 rue de Rouen, 76000 Rouen',
  siret: '12345678901234',
  vatNumber: 'FR00123456789',
};

describe('composition du devis', () => {
  it('mensuel avec module : trois lignes, montants de la grille', () => {
    const doc = buildDevisDocument(
      LEAD,
      { plan: 'complet', onlineOrdering: true, billing: 'mensuel', note: 'attend son associé' },
      ISSUER,
      NOW,
    );

    expect(doc.lignes.map((l) => [l.recurrence, l.montantHtCents])).toEqual([
      ['par mois', 15_900],
      ['par mois', 7_900],
      ['une fois', 5_500],
    ]);
    expect(doc.number).toBe('DEV-20260824-7b8c');
    expect(doc.validUntil).toBe('2026-09-23T12:00:00.000Z');
    expect(doc.customer.name).toBe('Chez Nicolas');
    expect(doc.contactLine).toContain('02 32 00 00 00');
    // La note interne ne sort JAMAIS sur le document client.
    expect(JSON.stringify(doc)).not.toContain('associé');
    expect(doc.gaps).toHaveLength(0);
  });

  it('annuel : une ligne à dix mois ; Boost : jamais de module facturé', () => {
    const doc = buildDevisDocument(
      LEAD,
      { plan: 'boost', onlineOrdering: true, billing: 'annuel', note: '' },
      ISSUER,
      NOW,
    );
    // Boost 199 € — la case module cochée par réflexe ne facture rien de plus.
    expect(doc.lignes).toHaveLength(1);
    expect(doc.lignes[0]?.montantHtCents).toBe(199_000);
    expect(doc.lignes[0]?.recurrence).toBe('par an');
    expect(doc.conditions.join(' ')).toContain('deux mois offerts');
  });

  it('émetteur incomplet : les manques sont déclarés, rien n’est inventé', () => {
    const doc = buildDevisDocument(
      LEAD,
      { plan: 'essentiel', onlineOrdering: false, billing: 'mensuel', note: '' },
      EMPTY_PARTY,
      NOW,
    );
    expect(doc.gaps.length).toBeGreaterThanOrEqual(4);
    expect(doc.lignes).toHaveLength(1);
  });
});

describe('rendu PDF', () => {
  it('produit un PDF d’une page qui porte le mot DEVIS et le bon pour accord', () => {
    const doc = buildDevisDocument(
      LEAD,
      { plan: 'complet', onlineOrdering: true, billing: 'mensuel', note: '' },
      ISSUER,
      NOW,
    );
    const pdf = renderDevisPdf(doc).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('DEVIS');
    expect(pdf).toContain('BON POUR ACCORD');
    expect(pdf).toContain('DEV-20260824-7b8c');
  });
});
