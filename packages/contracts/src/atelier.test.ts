import { describe, expect, it } from 'vitest';
import {
  ATELIER_ONCE_CENTS,
  EMPTY_SERVICES,
  LeadProposalSchema,
  LeadServicesSchema,
  SOCIAL_CADENCE_CENTS,
  proposalCents,
  servicesCents,
} from './crm';

/**
 * L'Atelier chiffre depuis la grille, et la grille seulement : ces tests
 * verrouillent la SÉPARATION logiciel/services (seul le logiciel s'annualise)
 * et les règles du schéma (site neuf et refonte s'excluent).
 */

describe('servicesCents', () => {
  it('rien de coché : zéro partout', () => {
    expect(servicesCents(EMPTY_SERVICES)).toEqual({ monthlyCents: 0, onceCents: 0 });
  });

  it('additionne mensuels et ponctuels chacun de leur côté', () => {
    expect(
      servicesCents({
        ...EMPTY_SERVICES,
        siteVitrine: true,
        identiteVisuelle: true,
        presenceInternet: true,
        reseauxSociaux: 'bihebdo',
      }),
    ).toEqual({
      monthlyCents: 6_900 + SOCIAL_CADENCE_CENTS.bihebdo,
      onceCents: ATELIER_ONCE_CENTS.siteVitrine + ATELIER_ONCE_CENTS.identiteVisuelle,
    });
  });
});

describe('proposalCents avec services', () => {
  it('sépare le logiciel (annualisable) des services (jamais annualisés)', () => {
    const prix = proposalCents({
      plan: 'complet',
      onlineOrdering: true,
      services: { ...EMPTY_SERVICES, presenceInternet: true, refonteSite: true },
    });
    expect(prix.monthlyCents).toBe(15_900 + 7_900);
    expect(prix.servicesMonthlyCents).toBe(6_900);
    // La mise en service du module ET la refonte, ensemble côté « une fois ».
    expect(prix.setupOnceCents).toBe(5_500 + ATELIER_ONCE_CENTS.refonteSite);
  });

  it('sans services : mêmes chiffres qu’avant l’Atelier', () => {
    const prix = proposalCents({ plan: 'boost', onlineOrdering: true });
    expect(prix).toEqual({ monthlyCents: 19_900, servicesMonthlyCents: 0, setupOnceCents: 0 });
  });
});

describe('LeadServicesSchema', () => {
  it('refuse site neuf ET refonte sur la même proposition', () => {
    expect(
      LeadServicesSchema.safeParse({ ...EMPTY_SERVICES, siteVitrine: true, refonteSite: true })
        .success,
    ).toBe(false);
  });

  it('remplit les défauts — les propositions d’avant l’Atelier restent lisibles', () => {
    expect(LeadServicesSchema.parse({})).toEqual(EMPTY_SERVICES);
    const proposition = LeadProposalSchema.parse({ plan: 'essentiel' });
    expect(proposition.services).toEqual(EMPTY_SERVICES);
  });
});
