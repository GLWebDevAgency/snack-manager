import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';
import { allergensOf, costOf, costRangeOf, marginOf } from './food-cost';
import { OptionChoice, OptionGroup, Recipe, RecipeLine } from './recipe';
import {
  PRIX_TACOS_M,
  saucesSupplement,
  tacosRecipe,
  viandesM,
  viandesXXL,
  VIANDE_KEBAB,
} from './tacos.fixture';
import { Quantity } from './units';

describe('Coût matière', () => {
  it('compte les viandes imposées dans le coût du tacos', () => {
    // LE bug historique : la recette de base ne coûte que 1,02 € (galette,
    // frites, sauce fromagère, barquette). Aucun tacos ne sort sans viande,
    // et la viande pèse 1,88 € de plus.
    const base = tacosRecipe().cost();
    expect(base.format()).toBe('1,02 €');

    const complet = costOf(tacosRecipe(), [viandesM()]);
    expect(complet.format()).toBe('2,90 €');
  });

  it('laisse les options facultatives hors du coût du produit', () => {
    // La samouraï est facturée en supplément et le client peut s'en passer :
    // la compter gonflerait artificiellement le prix de revient.
    const avecSupplements = costOf(tacosRecipe(), [viandesM(), saucesSupplement()]);
    expect(avecSupplements.format()).toBe('2,90 €');
  });

  it('compte quatre viandes sur le XXL même si la carte n’en propose que trois', () => {
    // Le client a le droit de prendre deux fois la même. Plafonner à trois
    // choix distincts sous-estimerait le coût du produit le plus vendu.
    const groupe = viandesXXL();
    expect(groupe.cheapestCost().format()).toBe('6,44 €'); // 4 × merguez
    expect(groupe.dearestCost().format()).toBe('8,40 €'); // 4 × cordon bleu
    expect(groupe.typicalCost().format()).toBe('7,53 €');
  });

  it('donne la fourchette de coût selon la viande retenue', () => {
    const range = costRangeOf(tacosRecipe(), [viandesM()]);
    expect(range.min.format()).toBe('2,63 €'); // 1,02 € + merguez 1,61 €
    expect(range.typical.format()).toBe('2,90 €');
    expect(range.max.format()).toBe('3,12 €'); // 1,02 € + cordon bleu 2,10 €
  });

  it('ne plante pas sur un produit dont la recette n’est pas encore saisie', () => {
    expect(costOf(null).format()).toBe('0,00 €');
    expect(costRangeOf(null).max.format()).toBe('0,00 €');
  });
});

describe('Marge', () => {
  it('se calcule sur le coût complet, options imposées comprises', () => {
    const marge = marginOf(PRIX_TACOS_M, costOf(tacosRecipe(), [viandesM()]));
    expect(marge.amount.format()).toBe('5,60 €');
    expect(marge.percent).toBe(65.9);
    // Le food cost, l'indicateur réellement suivi en cuisine.
    expect(marge.foodCostPercent).toBe(34.1);
  });

  it('afficherait une marge mensongère si les viandes imposées étaient oubliées', () => {
    // Reproduction du bug : 88 % de marge annoncée sur un produit qui en fait
    // 66 %. Un gérant qui baisse ses prix sur cette base perd de l'argent.
    const faux = marginOf(PRIX_TACOS_M, tacosRecipe().cost());
    expect(faux.percent).toBe(88);
    expect(faux.percent - marginOf(PRIX_TACOS_M, costOf(tacosRecipe(), [viandesM()])).percent)
      .toBeGreaterThan(20);
  });

  it('devient négative quand le produit est vendu à perte', () => {
    const marge = marginOf(Money.fromCents(250), costOf(tacosRecipe(), [viandesM()]));
    expect(marge.isNegative()).toBe(true);
    expect(marge.amount.format()).toBe('-0,40 €');
  });

  it('ne divise pas par zéro sur un produit offert', () => {
    const marge = marginOf(Money.ZERO, costOf(tacosRecipe(), [viandesM()]));
    expect(marge.percent).toBe(0);
    expect(marge.foodCostPercent).toBe(0);
  });
});

describe('Allergènes', () => {
  it('réunit ceux de la recette et ceux de toutes les options', () => {
    // Gluten et lait viennent de la galette et de la sauce fromagère ; les œufs
    // du cordon bleu ; moutarde et sulfites de la samouraï en supplément. Un
    // client allergique doit voir le risque AVANT d'ouvrir le configurateur.
    const allergenes = allergensOf(tacosRecipe(), [viandesM(), saucesSupplement()]);
    expect(allergenes).toEqual(['gluten', 'oeufs', 'lait', 'moutarde', 'sulfites']);
  });

  it('suit l’ordre de l’annexe INCO, pas l’ordre de saisie', () => {
    const allergenes = allergensOf(tacosRecipe(), [viandesM()]);
    expect(allergenes).toEqual(['gluten', 'oeufs', 'lait']);
  });

  it('reste totale sur un produit sans recette ni option', () => {
    // Obligation légale d'affichage : la fonction ne peut ni échouer ni surprendre.
    expect(allergensOf(null)).toEqual([]);
    expect(allergensOf(null, [saucesSupplement()])).toEqual(['oeufs', 'moutarde', 'sulfites']);
  });
});

describe('Recipe', () => {
  it('refuse une recette vide, indistinguable d’une recette absente', () => {
    const empty = Recipe.create([]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('recipe.invalid');
  });

  it('refuse le même ingrédient saisi deux fois', () => {
    const duplicated = Recipe.create([
      unwrap(RecipeLine.create(VIANDE_KEBAB, unwrap(Quantity.of(150, 'g')))),
      unwrap(RecipeLine.create(VIANDE_KEBAB, unwrap(Quantity.of(50, 'g')))),
    ]);
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.error.message).toContain('Viande kebab');
  });

  it('n’est plus produisible dès qu’un ingrédient passe en rupture', () => {
    // Rupture de galette un samedi soir : le tacos disparaît de la carte.
    const rupture = unwrap(
      Recipe.create([
        unwrap(RecipeLine.create(VIANDE_KEBAB.markOut(true), unwrap(Quantity.of(150, 'g')))),
      ]),
    );
    expect(rupture.isProducible()).toBe(false);
    expect(rupture.missingIngredients().map((i) => i.name)).toEqual(['Viande kebab']);
  });
});

describe('OptionGroup', () => {
  it('refuse d’imposer un choix dans un groupe qui n’en propose aucun', () => {
    const impossible = OptionGroup.create({ name: 'Viandes', minChoices: 1, choices: [] });
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) expect(impossible.error.code).toBe('option.group.invalid');
  });

  it('refuse un maximum inférieur au minimum', () => {
    const inverted = OptionGroup.create({
      name: 'Viandes',
      minChoices: 2,
      maxChoices: 1,
      choices: [unwrap(OptionChoice.create('Kebab'))],
    });
    expect(inverted.ok).toBe(false);
  });

  it('ne coûte rien tant qu’il reste facultatif', () => {
    expect(saucesSupplement().isRequired()).toBe(false);
    expect(saucesSupplement().typicalCost().isZero()).toBe(true);
  });
});
