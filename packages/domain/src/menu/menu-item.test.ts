import { describe, expect, it } from 'vitest';
import { croustyEnRupture, frites, sauces, tacos, tiramisu, viandes } from './fixtures';
import { MenuItem } from './menu-item';
import { OptionChoice } from './option-choice';
import { OptionGroup } from './option-group';
import { ProductId } from './product-id';
import { Variant } from './variant';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';

const id = (value: string): ProductId => unwrap(ProductId.create(value));
const kebab = unwrap(OptionChoice.create({ key: 'kebab', name: 'Kebab' }));

describe('ProductId', () => {
  it('refuse un identifiant vide', () => {
    const r = ProductId.create('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('menu.product-id.invalid');
  });

  it('refuse une valeur trop longue pour être un identifiant', () => {
    expect(ProductId.create('x'.repeat(65)).ok).toBe(false);
  });

  it('deux identifiants de même valeur désignent le même produit', () => {
    expect(id('tacos').equals(id('tacos'))).toBe(true);
    expect(id('tacos').equals(id('frites'))).toBe(false);
  });
});

describe('OptionGroup — cohérence de la fiche produit', () => {
  it('un groupe sans aucun choix est refusé', () => {
    const r = OptionGroup.create({ key: 'viandes', name: 'Viandes', mode: 'multi', choices: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('Le groupe « Viandes » ne propose aucun choix');
  });

  it('un groupe à choix unique ne peut pas en accepter deux', () => {
    const r = OptionGroup.create({
      key: 'gratine',
      name: 'Gratiné',
      mode: 'single',
      max: 2,
      choices: [kebab],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('menu.definition.invalid');
  });

  it('un groupe à choix unique est borné à un sans qu’on le déclare', () => {
    const group = unwrap(
      OptionGroup.create({ key: 'g', name: 'Gratiné', mode: 'single', choices: [kebab] }),
    );
    expect(group.max).toBe(1);
  });

  it('le même choix déclaré deux fois est refusé', () => {
    const r = OptionGroup.create({
      key: 'viandes',
      name: 'Viandes',
      mode: 'multi',
      choices: [kebab, kebab],
    });
    expect(r.ok).toBe(false);
  });

  it('des bornes inversées sont refusées', () => {
    const r = OptionGroup.create({
      key: 'viandes',
      name: 'Viandes',
      mode: 'multi',
      min: 3,
      max: 1,
      choices: [kebab],
    });
    expect(r.ok).toBe(false);
  });

  it('une borne fractionnaire est refusée', () => {
    const r = OptionGroup.create({
      key: 'viandes',
      name: 'Viandes',
      mode: 'multi',
      min: 1.5,
      choices: [kebab],
    });
    expect(r.ok).toBe(false);
  });

  it('un groupe obligatoire se reconnaît à son minimum', () => {
    expect(viandes.isMandatory()).toBe(true);
    expect(sauces.isMandatory()).toBe(false);
  });
});

describe('MenuItem — la fiche produit', () => {
  it('un produit doit avoir un nom', () => {
    const r = MenuItem.create({ id: id('x'), name: '  ' });
    expect(r.ok).toBe(false);
  });

  it('deux formats ne peuvent pas partager la même clé', () => {
    const r = MenuItem.create({
      id: id('tacos'),
      name: 'Tacos',
      variants: [
        unwrap(Variant.create({ key: 'M', name: 'M', price: Money.fromCents(890) })),
        unwrap(Variant.create({ key: 'M', name: 'Moyen', price: Money.fromCents(990) })),
      ],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('« Tacos » déclare deux fois le format « M »');
  });

  it('une dérogation qui vise un format inexistant est refusée', () => {
    // « XLL » au lieu de « XXL » : personne ne le voit, et le gratiné se
    // facture 1,50 € au lieu de 2,00 € sur chaque XXL jusqu’à l’inventaire.
    const gratineFaute = unwrap(
      OptionGroup.create({
        key: 'gratine',
        name: 'Gratiné',
        mode: 'single',
        choices: [unwrap(OptionChoice.create({ key: 'g', name: 'Gratiné', priceDelta: Money.fromCents(150) }))],
        perVariant: { XLL: { priceDelta: Money.fromCents(200) } },
      }),
    );

    const r = MenuItem.create({
      id: id('tacos'),
      name: 'Tacos',
      variants: [unwrap(Variant.create({ key: 'XXL', name: 'XXL', price: Money.fromCents(1450) }))],
      optionGroups: [gratineFaute],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe(
        'Le groupe « Gratiné » de « Tacos » vise un format inconnu : « XLL »',
      );
    }
  });

  it('un prix de vente négatif est refusé', () => {
    const r = MenuItem.create({ id: id('x'), name: 'Tiramisu', price: Money.fromCents(-100) });
    expect(r.ok).toBe(false);
  });

  it('le prix d’appel est celui du format le moins cher', () => {
    // « Compose ton Tacos, à partir de 8,90 € » sur la vitrine.
    expect(tacos.startingPrice().format()).toBe('8,90 €');
    expect(frites.startingPrice().format()).toBe('3,50 €');
    expect(tiramisu.startingPrice().format()).toBe('3,50 €');
  });

  it('un produit en rupture reste à la carte mais n’est pas disponible', () => {
    expect(croustyEnRupture.isAvailable()).toBe(false);
    expect(croustyEnRupture.name).toBe('Crousty One — Riz');
  });

  it('le réassort rend le produit disponible sans toucher au reste de la fiche', () => {
    const reassort = croustyEnRupture.withAvailability(true);
    expect(reassort.isAvailable()).toBe(true);
    // L’instance d’origine n’a pas bougé : deux écrans peuvent tenir la carte.
    expect(croustyEnRupture.isAvailable()).toBe(false);
  });

  it('un retrait est reconnu quels que soient les accents, la casse et le « sans »', () => {
    expect(tacos.canonicalRemoval('CRUDITES')).toBe('crudités');
    expect(tacos.canonicalRemoval('sans Oignons')).toBe('oignons');
    expect(tacos.canonicalRemoval('gluten')).toBeUndefined();
  });

  it('un produit à formats refuse de donner un prix sans format', () => {
    const r = tacos.basePriceFor(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('menu.variant.required');
  });

  it('un produit à prix simple ignore le format qu’on lui passe', () => {
    expect(unwrap(tiramisu.basePriceFor('M')).format()).toBe('3,50 €');
  });

  it('un retrait déclaré deux fois n’apparaît qu’une fois', () => {
    const item = unwrap(
      MenuItem.create({
        id: id('p'),
        name: 'Panini',
        price: Money.fromCents(700),
        removables: ['crudités', 'Crudites', 'oignons'],
      }),
    );
    expect(item.removables).toEqual(['crudités', 'oignons']);
  });
});
