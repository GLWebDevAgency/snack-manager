import { describe, expect, it } from 'vitest';
import {
  ATELIER_ONCE_CENTS,
  EMPTY_SERVICES,
  MODULE_ORDERING_CENTS,
  abonnementMensuelCents,
  offreClient,
  LeadConvertSchema,
  LeadProposalSchema,
  LeadServicesSchema,
  TenantOffreSchema,
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

  it('sans formule, le module ne se vend que greffé : l’intégration est exigée', () => {
    // Le module « seul » (79 € + 55 €) n'existe qu'adossé à une formule.
    expect(
      LeadProposalSchema.safeParse({ plan: null, onlineOrdering: true }).success,
    ).toBe(false);
    expect(
      LeadProposalSchema.safeParse({
        plan: null,
        onlineOrdering: true,
        services: { ...EMPTY_SERVICES, integrationCommande: true },
      }).success,
    ).toBe(true);
    // La même règle verrouille la signature.
    expect(
      LeadConvertSchema.safeParse({
        slug: 'chez-nicolas',
        ownerEmail: 'nicolas@exemple.fr',
        plan: null,
        onlineOrdering: true,
      }).success,
    ).toBe(false);
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

/**
 * DU LEAD AU CLIENT — le chiffrage doit survivre à la signature.
 *
 * `proposalCents` chiffre une PROPOSITION : elle porte la formule, le module
 * et les services, et le devis l'honore entièrement. Mais après la signature,
 * toute la facturation lisait `tenant.plan` SEUL : montant par défaut d'une
 * facture, MRR de la fiche client, projection d'échéance, écran « Abonnement »
 * du restaurateur, MRR du parc.
 *
 * Un client Complet avec le module était donc facturé 159 € au lieu de 238 €,
 * et un client sans formule — qui paie pourtant tous les mois — n'avait jamais
 * de prochaine échéance annoncée. `abonnementMensuelCents` est le pendant de
 * `proposalCents` côté client : une seule source pour le montant récurrent.
 */
describe('abonnementMensuelCents — ce qu’un client paie vraiment chaque mois', () => {
  it('formule et module s’additionnent : c’est là que la facturation sous-facturait', () => {
    expect(abonnementMensuelCents(offreClient({ plan: 'complet', onlineOrdering: true }))).toBe(
      15_900 + MODULE_ORDERING_CENTS,
    );
  });

  it('la formule seule reste la formule seule', () => {
    expect(abonnementMensuelCents(offreClient({ plan: 'complet', onlineOrdering: false }))).toBe(15_900);
  });

  it('sur Boost le module est compris — le facturer serait le faire payer deux fois', () => {
    expect(abonnementMensuelCents(offreClient({ plan: 'boost', onlineOrdering: true }))).toBe(19_900);
  });

  it('sans formule, les services mensuels sont bien un abonnement — pas zéro', () => {
    // Le défaut le plus coûteux : ce client payait 69 € + réseaux tous les
    // mois et n'apparaissait dans aucune projection d'échéance.
    expect(
      abonnementMensuelCents(offreClient({
        plan: null,
        onlineOrdering: false,
        atelier: { ...EMPTY_SERVICES, presenceInternet: true, reseauxSociaux: 'hebdo' },
      })),
    ).toBe(6_900 + SOCIAL_CADENCE_CENTS.hebdo);
  });

  it('les trois dimensions ensemble', () => {
    expect(
      abonnementMensuelCents(offreClient({
        plan: 'essentiel',
        onlineOrdering: true,
        atelier: { ...EMPTY_SERVICES, presenceInternet: true },
      })),
    ).toBe(9_900 + MODULE_ORDERING_CENTS + 6_900);
  });

  it('un client signé avant ces champs ne fait pas exploser le calcul', () => {
    // Les tenants d'avant portent `onlineOrdering` absent et `atelier` null :
    // le montant retombe sur la formule, sans jamais lever.
    expect(abonnementMensuelCents(offreClient({ plan: 'complet' }))).toBe(15_900);
    expect(abonnementMensuelCents(offreClient({ plan: 'complet', atelier: null }))).toBe(15_900);
    expect(abonnementMensuelCents(offreClient({ plan: null }))).toBe(0);
  });

  it('l’Atelier stocké porte un signedAt : il ne doit pas gêner le chiffrage', () => {
    expect(
      abonnementMensuelCents(offreClient({
        plan: null,
        atelier: { ...EMPTY_SERVICES, presenceInternet: true, signedAt: new Date() },
      })),
    ).toBe(6_900);
  });
});

/**
 * CHANGER L'OFFRE D'UN CLIENT APRÈS LA SIGNATURE.
 *
 * La seule route qui existait, `PATCH /crm/tenants/:id/plan`, ne portait que la
 * formule — et son énumération excluait `null`, si bien qu'on ne pouvait même
 * pas dégrader un client vers « Atelier seul ». Le module de commande en ligne
 * et les services n'étaient ni affichables, ni activables, ni retirables : un
 * restaurateur qui ajoutait les réseaux sociaux six mois plus tard n'avait
 * aucun chemin dans le logiciel.
 *
 * Le nouveau schéma porte l'offre entière et REJOUE les trois règles de
 * composition de la proposition. Les redéfinir ici en produirait des jumelles
 * qui divergeraient au premier changement — et on ne saurait plus laquelle fait
 * foi, celle qui vend ou celle qui modifie.
 */
describe('TenantOffreSchema — modifier ce qu’un client achète', () => {
  const BASE = { services: EMPTY_SERVICES, reason: 'Le gérant veut les écrans de salle.' };

  it('accepte une formule seule', () => {
    const r = TenantOffreSchema.safeParse({ ...BASE, plan: 'complet', onlineOrdering: false });
    expect(r.success).toBe(true);
  });

  it('accepte de RETIRER la formule — c’était impossible avant', () => {
    const r = TenantOffreSchema.safeParse({
      ...BASE,
      plan: null,
      onlineOrdering: false,
      services: { ...EMPTY_SERVICES, presenceInternet: true },
    });
    expect(r.success).toBe(true);
  });

  it('rejoue la règle du module greffé : sans formule, il exige l’intégration', () => {
    expect(
      TenantOffreSchema.safeParse({ ...BASE, plan: null, onlineOrdering: true }).success,
    ).toBe(false);
    expect(
      TenantOffreSchema.safeParse({
        ...BASE,
        plan: null,
        onlineOrdering: true,
        services: { ...EMPTY_SERVICES, integrationCommande: true },
      }).success,
    ).toBe(true);
  });

  it('rejoue la règle de l’intégration : elle exige le module ou Boost', () => {
    expect(
      TenantOffreSchema.safeParse({
        ...BASE,
        plan: 'essentiel',
        onlineOrdering: false,
        services: { ...EMPTY_SERVICES, integrationCommande: true },
      }).success,
    ).toBe(false);
  });

  it('refuse une offre vide : un client qui n’achète rien n’est pas un client', () => {
    expect(
      TenantOffreSchema.safeParse({ ...BASE, plan: null, onlineOrdering: false }).success,
    ).toBe(false);
  });

  it('le motif est facultatif mais borné — un journal se relit', () => {
    expect(
      TenantOffreSchema.parse({ plan: 'boost', onlineOrdering: false, services: EMPTY_SERVICES }).reason,
    ).toBe('');
    expect(
      TenantOffreSchema.safeParse({ ...BASE, plan: 'boost', onlineOrdering: false, reason: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('l’engagement se change aussi — mensuel par défaut', () => {
    const r = TenantOffreSchema.parse({ plan: 'complet', onlineOrdering: false, services: EMPTY_SERVICES });
    expect(r.billing).toBe('mensuel');
    expect(
      TenantOffreSchema.parse({ ...BASE, plan: 'complet', onlineOrdering: false, billing: 'annuel' }).billing,
    ).toBe('annuel');
  });
});
