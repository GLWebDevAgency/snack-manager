import { describe, expect, it } from 'vitest';
import { StripeConnectHttpClient } from './stripe-connect.client';

/**
 * CE TEST GARDE UNE PANNE SILENCIEUSE.
 *
 * L'adaptateur charge le SDK Stripe par import dynamique et rattrape l'échec :
 * si le paquet disparaît des dépendances, rien ne casse au démarrage, aucune
 * requête n'échoue, aucun test unitaire ne rougit — l'écran « Encaissement en
 * ligne » se contente d'afficher « bientôt disponible » et plus aucun
 * restaurateur ne peut raccorder son compte. La panne se découvre en
 * production, par un client qui ne peut pas payer.
 *
 * Ce qui suit est donc le seul endroit du dépôt où l'on charge le vrai paquet.
 * Les autres tests du module passent une doublure de `StripeConnectClient` et
 * ne diraient rien de son absence.
 */

const CLE_FACTICE = 'sk_test_0000000000000000000000000';

describe('l’adaptateur Stripe Connect', () => {
  it('se déclare disponible quand la clé est là — donc le paquet aussi', async () => {
    // `disponible()` ne fait AUCUN appel réseau : il ne prouve que deux choses,
    // et ce sont exactement les deux qui manquaient — le paquet se résout, et
    // son constructeur accepte une clé.
    await expect(new StripeConnectHttpClient(CLE_FACTICE).disponible()).resolves.toBe(true);
  });

  it('se déclare indisponible sans clé — le comptoir continue de servir', async () => {
    await expect(new StripeConnectHttpClient(null).disponible()).resolves.toBe(false);
    await expect(new StripeConnectHttpClient('   ').disponible()).resolves.toBe(false);
  });
});
