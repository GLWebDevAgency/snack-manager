import { describe, expect, it } from 'vitest';
import { journalDeTest } from '../audit/audit.fakes';
import { OrdersService } from './orders.service';

/**
 * L'AUTEUR D'UNE ANNULATION EST CELUI DONT LE CODE A ÉTÉ RE-SAISI.
 *
 * La tablette du comptoir est en session « caisse » quand le gérant vient
 * taper SON code par-dessus pour autoriser un geste : c'est délibéré, le
 * contrôleur le dit. Le registre doit donc nommer le gérant, pas la session
 * ouverte — sans quoi il désigne systématiquement la mauvaise personne au
 * moment précis où l'identité compte.
 */

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const ORDER = '665f0d0a1c2b3d4e5f6a7b8c';
const GERANT = '665f0d0a1c2b3d4e5f6a7b02';

function atelier() {
  const { audit, lignes } = journalDeTest({
    staff: [{ _id: GERANT, name: 'Sarah', role: 'gerant' }],
  });
  const service = new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { publish: () => {} } as never,
    audit,
    {} as never,
    { pourTenant: async () => ["bo"] } as never,
  );
  (service as unknown as { byId: () => Promise<unknown> }).byId = async () => ({
    _id: ORDER,
    number: 42,
    status: 'ready',
    statusHistory: [],
    payment: { status: 'paid', method: 'counter', tender: 'card' },
    totals: { subtotal: 2_000, discount: null, total: 2_000 },
    save: async () => {},
    toObject: () => ({}),
  });
  return { service, lignes };
}

describe('une annulation de commande', () => {
  it('nomme le valideur du code, avec son rôle et le moyen « tablette »', async () => {
    const { service, lignes } = atelier();

    await service.cancel(TENANT, ORDER, { staffId: GERANT, role: 'gerant' }, 'Erreur de saisie');

    expect(lignes[0]).toMatchObject({
      action: 'order.cancel',
      // `staffId` reste écrit : c'est le champ historique du registre, et les
      // lignes d'avant l'auteur n'ont que lui.
      staffId: GERANT,
      author: { id: GERANT, name: 'Sarah', role: 'gerant', means: 'pin' },
      meta: { reason: 'Erreur de saisie', number: 42, total: 2_000, role: 'gerant' },
    });
    // La date de vérification du code, telle que NF525 la demande.
    expect(lignes[0]!.pinVerifiedAt).toBeInstanceOf(Date);
  });
});
