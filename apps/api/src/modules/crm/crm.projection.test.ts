import { describe, expect, it } from 'vitest';
import { TENANT_FIELDS } from './crm.service';

/**
 * UNE PROJECTION MONGO QUI OUBLIE UN CHAMP NE LÈVE PAS.
 *
 * Elle rend `undefined`, et le calcul qui s'en sert retombe silencieusement sur
 * sa valeur par défaut. Aucune erreur, aucun journal, aucun test rouge — juste
 * un chiffre faux.
 *
 * C'est exactement ce qui est arrivé au MRR du parc : `listClients` ne chargeait
 * que `plan`, si bien que le module de commande en ligne (79 €/mois) et les
 * mensuels de l'Atelier n'entraient dans aucun total. Le tableau de bord
 * annonçait un chiffre d'affaires récurrent inférieur au réel, et rien ne
 * pouvait le signaler.
 *
 * Ce test relie la projection au calcul : il ne vérifie pas un champ en
 * particulier, il vérifie que les deux listes ne divergent pas — aujourd'hui et
 * à chaque champ qu'on ajoutera au chiffrage.
 */
describe('la projection des clients', () => {
  /** Ce que `abonnementMensuelCents` lit sur un tenant pour chiffrer son mois. */
  const CHAMPS_DU_CHIFFRAGE = ['plan', 'onlineOrdering', 'atelier', 'founderUntil'] as const;

  it('charge tout ce dont le chiffrage a besoin', () => {
    const manquants = CHAMPS_DU_CHIFFRAGE.filter((c) => !(c in TENANT_FIELDS));
    expect(
      manquants,
      'Ces champs sont lus par le calcul du MRR mais absents de la projection : ' +
        'Mongo rendra `undefined` et le montant sera faux, sans erreur ni journal.',
    ).toEqual([]);
  });

  it('charge aussi de quoi identifier et situer le client', () => {
    // Sans eux, la liste s'affiche mais ne se lit pas : un client sans nom ni
    // date d'entrée n'est pas une ligne de CRM.
    for (const champ of ['name', 'slug', 'createdAt', 'account', 'founderSeat']) {
      expect(TENANT_FIELDS, `champ « ${champ} » attendu dans la projection`).toHaveProperty(champ);
    }
  });
});
