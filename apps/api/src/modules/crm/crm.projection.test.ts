import { describe, expect, it } from 'vitest';
import { offreClient } from '@sm/contracts';
import { TENANT_FIELDS } from './crm.service';

/**
 * UNE PROJECTION MONGO QUI OUBLIE UN CHAMP NE LÈVE PAS.
 *
 * Elle rend `undefined`, et le calcul qui s'en sert retombe silencieusement sur
 * sa valeur par défaut. Aucune erreur, aucun journal, aucun test rouge — juste
 * un chiffre faux.
 *
 * C'est arrivé DEUX FOIS. D'abord `onlineOrdering` et `atelier` : le module de
 * commande en ligne et les mensuels de l'Atelier n'entraient dans aucun total.
 * Puis, malgré ce test, `founderDiscountCents` et `billingCycle` : la remise
 * fondateur ne s'appliquait pas et un client annuel était compté à sa
 * mensualité faciale.
 *
 * ── POURQUOI LA PREMIÈRE VERSION DE CE TEST N'A RIEN VU ───────────────────
 *
 * Elle RECOPIAIT à la main la liste des champs du chiffrage. Deux listes
 * écrites séparément ne divergent pas moins que deux morceaux de code : ajouter
 * un champ à `offreClient` laissait la copie intacte, et le test restait vert
 * en affirmant dans son propre commentaire qu'il « vérifiait que les deux
 * listes ne divergent pas ».
 *
 * La liste est donc désormais OBSERVÉE : on donne à `offreClient` un objet qui
 * note ce qu'on lui demande. Un champ ajouté au chiffrage apparaît ici sans que
 * personne l'écrive, et fait tomber le test tant que la projection ne le charge
 * pas. Un test qui se met à jour tout seul est le seul qui tienne.
 */
describe('la projection des clients', () => {
  /** Les champs que `offreClient` lit RÉELLEMENT, relevés à l'exécution. */
  function champsDuChiffrage(): string[] {
    const lus = new Set<string>();
    const mouchard = new Proxy(
      {},
      {
        get(_cible, propriete) {
          if (typeof propriete === 'string') lus.add(propriete);
          return undefined;
        },
        has: () => true,
      },
    );
    offreClient(mouchard);
    return [...lus];
  }

  it('relève bien ce que le chiffrage consulte — sinon ce test ne prouve rien', () => {
    // Garde-fou du garde-fou : si le mouchard ne captait rien, le test suivant
    // passerait sur une liste vide et ne vérifierait plus rien du tout.
    const champs = champsDuChiffrage();
    expect(champs.length).toBeGreaterThanOrEqual(5);
    expect(champs).toContain('plan');
  });

  it('charge tout ce dont le chiffrage a besoin', () => {
    const manquants = champsDuChiffrage().filter((c) => !(c in TENANT_FIELDS));
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
