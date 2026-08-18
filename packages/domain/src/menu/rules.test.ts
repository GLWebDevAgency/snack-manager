import { describe, expect, it } from 'vitest';
import {
  croustyEnRupture,
  frites,
  gratine,
  pick,
  sauces,
  supplements,
  tacos,
  tiramisu,
  viandes,
} from './fixtures';
import { MenuItem } from './menu-item';
import { OptionChoice } from './option-choice';
import { OptionGroup } from './option-group';
import { ProductId } from './product-id';
import { priceOf, resolveRule, validateSelection } from './rules';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';

describe('resolveRule — la règle effective dépend du format', () => {
  it('un tacos M impose exactement une viande', () => {
    const rule = resolveRule(viandes, 'M');
    expect(rule.min).toBe(1);
    expect(rule.max).toBe(1);
  });

  it('un tacos XXL impose exactement quatre viandes', () => {
    const rule = resolveRule(viandes, 'XXL');
    expect(rule.min).toBe(4);
    expect(rule.max).toBe(4);
  });

  it('sans format choisi, on retombe sur les bornes générales du groupe', () => {
    const rule = resolveRule(viandes, null);
    expect(rule.min).toBe(1);
    expect(rule.max).toBe(4);
  });

  it('une dérogation qui ne fixe que le prix laisse les bornes du groupe intactes', () => {
    // Le gratiné coûte plus cher en XXL, mais reste un choix facultatif unique.
    const rule = resolveRule(gratine, 'XXL');
    expect(rule.min).toBe(0);
    expect(rule.max).toBe(1);
    expect(rule.priceDelta?.cents).toBe(200);
  });

  it('sans dérogation de prix, chaque choix garde son propre supplément', () => {
    expect(resolveRule(gratine, 'M').priceDelta).toBeNull();
  });

  it('un groupe sans maximum déclaré est illimité', () => {
    // Rien n'interdit dix suppléments fromage sur un XXL, si le client paie.
    expect(resolveRule(supplements, 'XXL').max).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('validateSelection — ce qui part en cuisine', () => {
  it('un tacos M avec une seule viande est accepté', () => {
    const config = validateSelection(tacos, 'M', [pick('viandes', 'kebab')]);
    expect(config.ok).toBe(true);
    if (config.ok) expect(config.value.unitPrice.format()).toBe('8,90 €');
  });

  it('un tacos M avec deux viandes est refusé', () => {
    const config = validateSelection(tacos, 'M', [
      pick('viandes', 'kebab'),
      pick('viandes', 'steak'),
    ]);

    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.code).toBe('option.rule');
      expect(config.error.message).toBe('« Viandes » : 1 choix attendu(s), 2 fourni(s)');
    }
  });

  it('un tacos commandé sans aucune viande est refusé', () => {
    const config = validateSelection(tacos, 'XXL', []);
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.error.code).toBe('option.rule');
  });

  it('un tacos XXL accepte deux fois la même viande', () => {
    // Cas courant du comptoir : « double kebab, steak, kefta ». Dédoublonner
    // servirait un XXL à deux viandes au prix de quatre.
    const config = validateSelection(tacos, 'XXL', [
      pick('viandes', 'kebab'),
      pick('viandes', 'kebab'),
      pick('viandes', 'steak'),
      pick('viandes', 'kefta'),
    ]);

    expect(config.ok).toBe(true);
    if (config.ok) expect(config.value.options).toHaveLength(4);
  });

  it('un format est obligatoire quand le produit en propose', () => {
    const config = validateSelection(tacos, null, [pick('viandes', 'kebab')]);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.code).toBe('menu.variant.required');
      expect(config.error.message).toBe('Choisissez un format pour « Compose ton Tacos »');
    }
  });

  it('un format inconnu est refusé plutôt que rabattu sur le premier de la liste', () => {
    const config = validateSelection(tacos, 'XXXL', [pick('viandes', 'kebab')]);
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.error.code).toBe('menu.variant.unknown');
  });

  it('un produit en rupture ne peut pas être commandé', () => {
    const config = validateSelection(croustyEnRupture, null, []);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.code).toBe('product.unavailable');
      expect(config.error.message).toBe('« Crousty One — Riz » est en rupture');
    }
  });

  it('une viande épuisée ne peut pas être choisie, le reste de la carte tient', () => {
    // 22 h, plus de cordon bleu : le tacos reste commandable avec les autres.
    const refuse = validateSelection(tacos, 'M', [pick('viandes', 'cordon-bleu')]);
    expect(refuse.ok).toBe(false);
    if (!refuse.ok) expect(refuse.error.message).toBe('« Cordon bleu » est en rupture');

    expect(validateSelection(tacos, 'M', [pick('viandes', 'poulet')]).ok).toBe(true);
  });

  it('deux sauces sont incluses, la troisième est refusée', () => {
    const trois = validateSelection(tacos, 'M', [
      pick('viandes', 'kebab'),
      pick('sauces', 'algerienne'),
      pick('sauces', 'blanche'),
      pick('sauces', 'samourai'),
    ]);

    expect(trois.ok).toBe(false);
    if (!trois.ok) {
      expect(trois.error.message).toBe('« Sauces » : entre 0 et 2 choix attendus, 3 fourni(s)');
    }
  });

  it('une option venue d’un autre produit est refusée', () => {
    const config = validateSelection(frites, 'M', [pick('viandes', 'kebab')]);
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.error.code).toBe('menu.option.unknown');
  });

  it('un choix qui n’existe pas dans le groupe est refusé', () => {
    const config = validateSelection(tacos, 'M', [pick('viandes', 'canard')]);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.message).toBe(
        'Choix indisponible pour « Compose ton Tacos » : « canard » dans « Viandes »',
      );
    }
  });

  it('un retrait est repris avec le libellé exact de la carte', () => {
    // La caisse envoie « Sans Oignons », la cuisine doit lire « oignons ».
    const config = validateSelection(tacos, 'M', [pick('viandes', 'kebab')], ['Sans Oignons']);
    expect(config.ok).toBe(true);
    if (config.ok) expect(config.value.removals).toEqual(['oignons']);
  });

  it('un retrait non prévu par la fiche produit est refusé', () => {
    const config = validateSelection(tacos, 'M', [pick('viandes', 'kebab')], ['gluten']);
    expect(config.ok).toBe(false);
    if (!config.ok) {
      expect(config.error.code).toBe('menu.removal.refused');
      expect(config.error.message).toBe(
        '« Compose ton Tacos » ne peut pas être servi sans gluten',
      );
    }
  });

  it('les retraits ne changent pas le prix', () => {
    const nu = unwrap(validateSelection(tacos, 'L', [pick('viandes', 'kebab'), pick('viandes', 'steak')]));
    const sansCrudites = unwrap(
      validateSelection(
        tacos,
        'L',
        [pick('viandes', 'kebab'), pick('viandes', 'steak')],
        ['crudités'],
      ),
    );

    expect(sansCrudites.unitPrice.equals(nu.unitPrice)).toBe(true);
  });

  it('le même retrait demandé deux fois n’est imprimé qu’une fois', () => {
    const config = unwrap(
      validateSelection(tacos, 'M', [pick('viandes', 'kebab')], ['oignons', 'sans oignons']),
    );
    expect(config.removals).toEqual(['oignons']);
  });

  it('un produit sans format ni option se valide tel quel', () => {
    const config = unwrap(validateSelection(tiramisu, null, []));
    expect(config.variant).toBeNull();
    expect(config.unitPrice.format()).toBe('3,50 €');
  });
});

describe('priceOf — le prix unitaire figé', () => {
  it('le gratiné coûte 1,50 € en M et 2,00 € en XXL', () => {
    const petit = priceOf(tacos, 'M', [pick('viandes', 'kebab'), pick('gratine', 'gratine')]);
    const grand = priceOf(tacos, 'XXL', [
      pick('viandes', 'kebab'),
      pick('viandes', 'kebab'),
      pick('viandes', 'steak'),
      pick('viandes', 'kefta'),
      pick('gratine', 'gratine'),
    ]);

    // 8,90 € + 1,50 € — le supplément par défaut du choix.
    expect(unwrap(petit).format()).toBe('10,40 €');
    // 14,50 € + 2,00 € — la dérogation XXL écrase le supplément du choix.
    expect(unwrap(grand).format()).toBe('16,50 €');
  });

  it('les suppléments s’additionnent au prix du format', () => {
    // Le tacos XXL du vendredi soir : 14,50 + 2,00 (gratiné) + 1,00 (cheddar).
    const prix = priceOf(tacos, 'XXL', [
      pick('viandes', 'kebab'),
      pick('viandes', 'kebab'),
      pick('viandes', 'steak'),
      pick('viandes', 'kefta'),
      pick('gratine', 'gratine'),
      pick('supp-1-00', 'cheddar'),
    ]);

    expect(unwrap(prix).format()).toBe('17,50 €');
  });

  it('les sauces incluses ne coûtent rien', () => {
    const prix = priceOf(tacos, 'M', [
      pick('viandes', 'kebab'),
      pick('sauces', 'algerienne'),
      pick('sauces', 'blanche'),
    ]);

    expect(unwrap(prix).format()).toBe('8,90 €');
  });

  it('chaque format porte son propre prix', () => {
    expect(unwrap(priceOf(frites, 'M', [])).format()).toBe('3,50 €');
    expect(unwrap(priceOf(frites, 'L', [])).format()).toBe('4,50 €');
  });

  it('une carte qui produirait un prix négatif est refusée', () => {
    // Un supplément négatif mal saisi (une remise déguisée en option) ne doit
    // jamais aboutir à un article que la caisse devrait rembourser.
    const remise = unwrap(
      OptionGroup.create({
        key: 'remise',
        name: 'Geste',
        mode: 'single',
        min: 1,
        max: 1,
        choices: [unwrap(OptionChoice.create({ key: 'oups', name: 'Oups', priceDelta: Money.fromCents(-1000) }))],
      }),
    );
    const item = unwrap(
      MenuItem.create({
        id: unwrap(ProductId.create('dessert-casse')),
        name: 'Dessert mal paramétré',
        price: Money.fromCents(350),
        optionGroups: [remise],
      }),
    );

    const prix = priceOf(item, null, [pick('remise', 'oups')]);
    expect(prix.ok).toBe(false);
    if (!prix.ok) expect(prix.error.code).toBe('menu.definition.invalid');
  });

  it('le groupe des sauces reste disponible sur tous les formats', () => {
    expect(sauces.isMandatory()).toBe(false);
  });
});
