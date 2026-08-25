import { describe, expect, it } from 'vitest';
import {
  ATELIER_ONCE_CENTS,
  EMPTY_SERVICES,
  LeadConvertSchema,
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

describe('l’intégration sur site existant', () => {
  it('exige le module : la proposition sans lui est refusée, Boost suffit', () => {
    const services = { ...EMPTY_SERVICES, integrationCommande: true };
    expect(
      LeadProposalSchema.safeParse({ plan: 'essentiel', services }).success,
    ).toBe(false);
    expect(
      LeadProposalSchema.safeParse({ plan: 'essentiel', onlineOrdering: true, services }).success,
    ).toBe(true);
    expect(LeadProposalSchema.safeParse({ plan: 'boost', services }).success).toBe(true);
  });

  it('comprend la mise en service : les 55 € ne se comptent pas en plus des 190 €', () => {
    const prix = proposalCents({
      plan: 'essentiel',
      onlineOrdering: true,
      services: { ...EMPTY_SERVICES, integrationCommande: true },
    });
    expect(prix.setupOnceCents).toBe(ATELIER_ONCE_CENTS.integrationCommande);
  });
});

describe('sans formule — les services se vendent seuls', () => {
  it('plan null : le logiciel pèse zéro, les services gardent leurs prix', () => {
    const prix = proposalCents({
      plan: null,
      onlineOrdering: false,
      services: { ...EMPTY_SERVICES, siteVitrine: true, reseauxSociaux: 'hebdo' },
    });
    expect(prix.monthlyCents).toBe(0);
    expect(prix.servicesMonthlyCents).toBe(SOCIAL_CADENCE_CENTS.hebdo);
    expect(prix.setupOnceCents).toBe(ATELIER_ONCE_CENTS.siteVitrine);
  });

  it('module seul sur site existant : 79 €/mois sans formule, intégration comprise', () => {
    const prix = proposalCents({
      plan: null,
      onlineOrdering: true,
      services: { ...EMPTY_SERVICES, integrationCommande: true },
    });
    expect(prix.monthlyCents).toBe(7_900);
    // L'intégration comprend la mise en service — jamais les 55 € en plus.
    expect(prix.setupOnceCents).toBe(ATELIER_ONCE_CENTS.integrationCommande);
  });

  it('accepte une proposition services seuls, refuse une proposition vide', () => {
    expect(
      LeadProposalSchema.safeParse({
        plan: null,
        services: { ...EMPTY_SERVICES, identiteVisuelle: true },
      }).success,
    ).toBe(true);
    // Rien sur la table : ni formule, ni module, ni service — rien à signer.
    expect(LeadProposalSchema.safeParse({ plan: null }).success).toBe(false);
  });

  it('la signature suit les mêmes règles, et garde Essentiel par défaut', () => {
    const base = { slug: 'chez-nicolas', ownerEmail: 'nicolas@exemple.fr' };
    expect(
      LeadConvertSchema.safeParse({
        ...base,
        plan: null,
        services: { ...EMPTY_SERVICES, presenceInternet: true },
      }).success,
    ).toBe(true);
    expect(LeadConvertSchema.safeParse({ ...base, plan: null }).success).toBe(false);
    // Les appels d'avant la formule optionnelle ne passent pas de plan : le
    // défaut historique reste Essentiel, jamais null par surprise.
    expect(LeadConvertSchema.parse(base).plan).toBe('essentiel');
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
