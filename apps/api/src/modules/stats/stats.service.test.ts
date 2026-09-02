import { describe, expect, it } from 'vitest';
import { excelCsvCell, excelCsvNumber } from './excel-csv';
import { StatsService } from './stats.service';

function queryOf<T>(rows: T[]) {
  const query = {
    sort: () => query,
    limit: () => query,
    lean: async () => rows,
  };
  return query;
}

describe('exports CSV sûrs pour les tableurs', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', '"\'\r=1+1"'],
    ['\n=1+1', '"\'\n=1+1"'],
    ['\u0000=1+1', "'\u0000=1+1"],
    ['＝1+1', "'＝1+1"],
    ['＋1+1', "'＋1+1"],
    ['－1+1', "'－1+1"],
    ['＠SUM(A1:A2)', "'＠SUM(A1:A2)"],
  ])('neutralise le préfixe dangereux de %j', (input, expected) => {
    expect(excelCsvCell(input)).toBe(expected);
  });

  it('préserve les noms, accents, nombres et règles CSV françaises', () => {
    expect(excelCsvCell('Élodie')).toBe('Élodie');
    expect(excelCsvCell("'=déjà inerte")).toBe("'=déjà inerte");
    expect(excelCsvCell('Jean; Luc')).toBe('"Jean; Luc"');
    expect(excelCsvCell('Jean "JP"')).toBe('"Jean ""JP"""');
    expect(excelCsvCell(-42)).toBe('-42');
    expect(excelCsvCell(excelCsvNumber('-42,00'))).toBe('-42,00');
  });

  it('rend inerte un nom client public qui commence comme une formule', async () => {
    const customerName = '=WEBSERVICE("https://example.invalid")';
    const rows = [
      {
        number: 'CMD-1',
        createdAt: new Date('2026-08-31T12:00:00.000Z'),
        channel: 'online',
        type: 'pickup',
        status: 'new',
        lines: [{ qty: 1, name: 'Tacos', variantName: null }],
        totals: { subtotal: -1_200, discount: null, total: -1_200 },
        payment: { method: 'counter', status: 'pending' },
        pickup: { customerName },
      },
    ];
    const orders = { find: () => queryOf(rows) };
    const service = new StatsService(orders as never, {} as never, {} as never, {} as never);

    const exported = await service.exportOrdersCsv('507f1f77bcf86cd799439011', {});

    expect(exported).toContain(';1× Tacos;-12,00;;-12,00;Comptoir;');
    expect(exported).toContain(`;"'${customerName.replaceAll('"', '""')}"\r\n`);
  });

  it('applique la même frontière aux textes importables du menu', async () => {
    const categoryId = '507f1f77bcf86cd799439012';
    const categories = {
      find: () => queryOf([{ _id: categoryId, name: '=Catégorie' }]),
    };
    const products = {
      find: () =>
        queryOf([
          {
            categoryId,
            name: '+Produit',
            description: '@Description',
            variants: [{ name: '-Variante', price: -1_200 }],
            price: -1_200,
            active: true,
            outOfStock: false,
          },
        ]),
    };
    const service = new StatsService({} as never, products as never, categories as never, {} as never);

    const exported = await service.exportMenuCsv('507f1f77bcf86cd799439011');

    expect(exported).toContain("'=Catégorie;'+Produit;'@Description;'-Variante;-12,00;Oui;Non\r\n");
  });
});
