import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isTerminal,
  mostAdvanced,
  nextStatus,
  StatusChange,
  transition,
} from './order-status';
import { FixedClock } from '../shared/clock';
import { InvariantViolation } from '../shared/errors';
import { unwrap } from '../shared/result';

describe('Machine à états d’une commande', () => {
  it('la commande suit la chaîne nouvelle → en préparation → prête → servie', () => {
    expect(unwrap(transition('new', 'preparing'))).toBe('preparing');
    expect(unwrap(transition('preparing', 'ready'))).toBe('ready');
    expect(unwrap(transition('ready', 'delivered'))).toBe('delivered');
  });

  it('on ne saute pas la préparation, même pour une canette', () => {
    // Sans passage par « en préparation », la cuisine ne voit jamais le ticket.
    const r = transition('new', 'ready');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('order.transition');
      expect(r.error.message).toBe('Passage de « nouvelle » à « prête » impossible');
    }
  });

  it('une commande ne revient jamais en arrière', () => {
    // Le double-tap de la tablette cuisine pendant que la caisse encaisse.
    expect(transition('ready', 'preparing').ok).toBe(false);
    expect(transition('delivered', 'ready').ok).toBe(false);
  });

  it('une commande servie ne change plus d’état', () => {
    expect(isTerminal('delivered')).toBe(true);
    expect(transition('delivered', 'cancelled').ok).toBe(false);
  });

  it('une commande annulée ne repart pas en préparation', () => {
    expect(isTerminal('cancelled')).toBe(true);
    expect(transition('cancelled', 'preparing').ok).toBe(false);
  });

  it('l’annulation reste possible tant que rien n’est servi', () => {
    expect(canTransition('new', 'cancelled')).toBe(true);
    expect(canTransition('preparing', 'cancelled')).toBe(true);
    expect(canTransition('ready', 'cancelled')).toBe(true);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
  });

  it('l’étape suivante s’arrête à la commande servie', () => {
    expect(nextStatus('new')).toBe('preparing');
    expect(nextStatus('ready')).toBe('delivered');
    expect(nextStatus('delivered')).toBeNull();
    expect(nextStatus('cancelled')).toBeNull();
  });
});

describe('Réconciliation hors ligne — le statut le plus avancé gagne', () => {
  it('le rejeu d’un statut dépassé ne fait pas reculer la commande', () => {
    // La caisse rejoue « en préparation » alors que la cuisine a marqué « prête ».
    expect(mostAdvanced('ready', 'preparing')).toBe('ready');
    expect(mostAdvanced('preparing', 'ready')).toBe('ready');
  });

  it('deux appareils d’accord ne changent rien', () => {
    expect(mostAdvanced('preparing', 'preparing')).toBe('preparing');
  });

  it('une annulation l’emporte sur une préparation en cours', () => {
    // Quelqu’un a physiquement décidé de ne pas servir : ça prime.
    expect(mostAdvanced('preparing', 'cancelled')).toBe('cancelled');
    expect(mostAdvanced('cancelled', 'ready')).toBe('cancelled');
  });

  it('une annulation rejouée n’efface pas une commande déjà servie', () => {
    // Le plat est parti et l’argent est encaissé : l’annuler creuserait la caisse.
    expect(mostAdvanced('delivered', 'cancelled')).toBe('delivered');
    expect(mostAdvanced('cancelled', 'delivered')).toBe('delivered');
  });
});

describe('Historique des statuts', () => {
  it('chaque changement retient son auteur et son instant', () => {
    const clock = new FixedClock(new Date('2026-06-20T20:14:00.000Z'));
    const change = StatusChange.record('preparing', 'caisse-2', clock);

    expect(change.status).toBe('preparing');
    expect(change.by).toBe('caisse-2');
    expect(change.at.toISOString()).toBe('2026-06-20T20:14:00.000Z');
  });

  it('un changement de statut sans auteur signale un bug, pas une saisie', () => {
    const clock = new FixedClock(new Date('2026-06-20T20:14:00.000Z'));
    expect(() => StatusChange.record('ready', '   ', clock)).toThrow(InvariantViolation);
  });

  it('l’instant enregistré ne peut pas être modifié après coup', () => {
    const clock = new FixedClock(new Date('2026-06-20T20:14:00.000Z'));
    const change = StatusChange.record('ready', 'cuisine-1', clock);

    change.at.setFullYear(2030);
    expect(change.at.getFullYear()).toBe(2026);
  });
});
