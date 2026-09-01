import { describe, expect, it, vi } from 'vitest';
import type { LoyaltyRewardView } from '@sm/contracts';
import {
  activeRewardsFor,
  discardTerminalEnrollmentRecovery,
  extractLoyaltyQrToken,
  isTerminalEnrollmentError,
  loyaltyQrPayload,
  parseLoyaltyEnrollmentRecovery,
  rejectedOrderIds,
  resumePreparingEnrollment,
} from './loyalty-state';

const MEMBER = '11111111-1111-4111-8111-111111111111';
describe('identifiants fidélité POS', () => {
  it("extrait localement le token brut ou le fragment d'une carte PWA", () => {
    const token = 'A'.repeat(43);
    expect(extractLoyaltyQrToken(token)).toBe(token);
    expect(
      extractLoyaltyQrToken(
        `https://commande.example/r/classfood/fidelite#card=${token}`,
        'classfood',
      ),
    ).toBe(token);
    expect(
      extractLoyaltyQrToken(
        `https://commande.example/r/autre/fidelite#card=${token}`,
        'classfood',
      ),
    ).toBeNull();
    expect(
      extractLoyaltyQrToken(
        `https://commande.example/r/classfood/fidelite?card=${token}`,
        'classfood',
      ),
    ).toBeNull();
    expect(extractLoyaltyQrToken('javascript:#card=' + token)).toBeNull();
  });

  it('émet une deep-link sans query et retombe sur le token si la config est absente', () => {
    const token = 'B'.repeat(43);
    const payload = loyaltyQrPayload(token, 'https://snackmanager.fr/', 'classfood');
    expect(payload).toBe(
      `https://snackmanager.fr/r/classfood/fidelite#card=${token}`,
    );
    expect(new URL(payload).search).toBe('');
    expect(loyaltyQrPayload(token, null, 'classfood')).toBe(token);
    expect(loyaltyQrPayload(token, 'javascript:', 'classfood')).toBe(token);
    expect(loyaltyQrPayload(token, 'https://user:pass@example.test', 'classfood')).toBe(token);
  });

  it('repère une vente refusée sans exposer son corps', () => {
    expect(
      [...rejectedOrderIds([{ path: '/orders', body: { clientId: 'c1', customerPhone: 'secret' } }])],
    ).toEqual(['c1']);
  });

  it("ne persiste pour la reprise d'adhésion que l'UUID et la phase", () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    expect(parseLoyaltyEnrollmentRecovery(JSON.stringify({ operationId }))).toEqual({
      operationId,
      phase: 'creating',
    });
    expect(
      parseLoyaltyEnrollmentRecovery(
        JSON.stringify({ operationId, phase: 'ack_pending' }),
      ),
    ).toEqual({
      operationId,
      phase: 'ack_pending',
    });
    expect(
      parseLoyaltyEnrollmentRecovery(
        JSON.stringify({ operationId, phone: '06 12 34 56 78' }),
      ),
    ).toBeNull();
    expect(
      parseLoyaltyEnrollmentRecovery(JSON.stringify({ operationId, phase: 'terminé' })),
    ).toBeNull();
    expect(parseLoyaltyEnrollmentRecovery('{cassé')).toBeNull();
  });

  it('ferme un PREPARE expiré au démarrage au lieu de bloquer toute nouvelle adhésion', async () => {
    const onClosed = vi.fn(async () => {});
    const prepare = vi.fn(async () => {
      throw Object.assign(new Error('Opération expirée'), { status: 410 });
    });

    await expect(
      resumePreparingEnrollment({
        operationId: MEMBER,
        prepare,
        onClosed,
      }),
    ).resolves.toBe('closed');
    expect(prepare).toHaveBeenCalledWith(MEMBER);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(isTerminalEnrollmentError({ status: 409 })).toBe(false);
  });

  it('ne clôture jamais une reprise sur une panne non terminale', async () => {
    const failure = Object.assign(new Error('Réseau indisponible'), { status: 503 });
    const onClosed = vi.fn(async () => {});
    await expect(
      resumePreparingEnrollment({
        operationId: MEMBER,
        prepare: async () => {
          throw failure;
        },
        onClosed,
      }),
    ).rejects.toBe(failure);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('tente de supprimer la reprise terminale et libère toujours l’automate mémoire', async () => {
    const resetMemory = vi.fn();
    const removeLocal = vi.fn(async () => {
      throw new Error('stockage indisponible');
    });

    await expect(
      discardTerminalEnrollmentRecovery(removeLocal, resetMemory),
    ).resolves.toBeUndefined();
    expect(removeLocal).toHaveBeenCalledOnce();
    expect(resetMemory).toHaveBeenCalledOnce();
  });
});

describe('catalogue fidélité POS', () => {
  const reward = (over: Partial<LoyaltyRewardView>): LoyaltyRewardView => ({
    id: '33333333-3333-4333-8333-333333333333',
    programId: '44444444-4444-4444-8444-444444444444',
    name: 'Boisson offerte',
    description: '',
    costUnits: 10,
    kind: 'product',
    valueCents: null,
    productRef: 'Boisson 33 cl',
    active: true,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...over,
  });

  it('filtre programme et activité puis trie par coût', () => {
    const programId = '44444444-4444-4444-8444-444444444444';
    expect(
      activeRewardsFor(
        [
          reward({ name: 'Dessert', costUnits: 20 }),
          reward({ name: 'Inactive', active: false, costUnits: 1 }),
          reward({ name: 'Autre', programId: MEMBER, costUnits: 2 }),
          reward({ name: 'Boisson', costUnits: 10 }),
        ],
        programId,
      ).map((item) => item.name),
    ).toEqual(['Boisson', 'Dessert']);
  });
});
