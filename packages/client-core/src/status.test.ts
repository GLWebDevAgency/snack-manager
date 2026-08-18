import { describe, expect, it } from 'vitest';
import { mostAdvancedStatus } from './types';

/**
 * Ces cas viennent du terrain : deux tablettes hors ligne font avancer la même
 * commande, puis se resynchronisent dans un ordre quelconque.
 */
describe('réconciliation des statuts hors ligne', () => {
  it('retient le statut le plus avancé de la progression normale', () => {
    expect(mostAdvancedStatus('new', 'preparing')).toBe('preparing');
    expect(mostAdvancedStatus('ready', 'preparing')).toBe('ready');
  });

  it('ne fait jamais reculer une commande', () => {
    // Un rechargement en retard ne doit pas renvoyer un ticket « prêt »
    // en préparation sous les yeux de la cuisine.
    expect(mostAdvancedStatus('ready', 'new')).toBe('ready');
  });

  it("n'annule pas une commande déjà remise au client", () => {
    // Le plat est parti et la caisse est faite : une annulation rejouée
    // depuis une tablette restée hors ligne ne doit pas l'emporter.
    expect(mostAdvancedStatus('delivered', 'cancelled')).toBe('delivered');
  });

  it('ne ressuscite pas une commande annulée', () => {
    expect(mostAdvancedStatus('cancelled', 'delivered')).toBe('cancelled');
    expect(mostAdvancedStatus('cancelled', 'ready')).toBe('cancelled');
  });

  it('accepte une annulation sur une commande encore en cours', () => {
    expect(mostAdvancedStatus('preparing', 'cancelled')).toBe('cancelled');
  });
});
