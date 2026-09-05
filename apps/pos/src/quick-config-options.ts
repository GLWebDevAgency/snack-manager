import { ruleFor, type OptionGroup, type SelectedOption } from '@sm/client-core';

/** Repricer un changement de taille sans perdre les suppléments hors groupes. */
export function optionsForVariant(groups: OptionGroup[], options: SelectedOption[], variantKey: string): SelectedOption[] {
  const kept: SelectedOption[] = [];
  const perGroup = new Map<string, number>();
  for (const opt of options) {
    const group = groups.find((g) => g.key === opt.groupKey);
    if (!group) {
      kept.push(opt);
      continue;
    }
    const { max, priceDelta } = ruleFor(group, variantKey);
    const used = perGroup.get(opt.groupKey) ?? 0;
    if (used >= max) continue;
    perGroup.set(opt.groupKey, used + 1);
    // Le delta de l'ancien état peut être un override : ce n'est jamais le
    // prix de référence quand on revient à une taille sans surcharge.
    const choice = group.choices.find((candidate) => candidate.key === opt.choiceKey);
    kept.push({ ...opt, priceDelta: priceDelta ?? choice?.priceDelta ?? opt.priceDelta });
  }
  return kept;
}
