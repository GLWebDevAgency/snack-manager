import { describe, expect, it } from 'vitest';
import { CreateOrderSchema, CreatePublicOrderSchema } from '@sm/contracts';
import { publicRecoveryBinding } from './order-recovery';
import {
  assertOrderAdmissionBinding, internalOrderAdmissionBinding, isPublicOrderAdmission,
  orderAdmissionId, publicRecoveryOfAdmission,
} from './order-admission-identity';

const TENANT = '507f1f77bcf86cd799439011';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const body = CreateOrderSchema.parse({ clientId: CLIENT, channel: 'phone', type: 'pickup',
  lines: [{ productId: 'burger', qty: 1 }], payment: { method: 'counter' },
  pickup: { slot: '2030-05-02T16:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
});
const publicBody = CreatePublicOrderSchema.parse({ clientId: CLIENT, lines: body.lines, payment: body.payment, pickup: body.pickup,
  recoveryProof: 'ab'.repeat(32), turnstileToken: 'once',
});

describe('identité interne commune, sans adoption publique', () => {
  it('conserve une seule identité tenant/client, indépendante du writer', () => {
    expect(orderAdmissionId(TENANT, CLIENT)).toMatch(/^[a-f0-9]{64}$/);
    expect(orderAdmissionId('other', CLIENT)).not.toBe(orderAdmissionId(TENANT, CLIENT));
    expect(orderAdmissionId(TENANT, 'other')).not.toBe(orderAdmissionId(TENANT, CLIENT));
  });
  it('interprète uniquement les anciennes admissions sans kind comme publiques', () => {
    expect(isPublicOrderAdmission({})).toBe(true);
    expect(isPublicOrderAdmission({ kind: 'public' })).toBe(true);
    for (const kind of ['staff', 'legacy', 'historical', 'unknown', null]) {
      expect(isPublicOrderAdmission({ kind })).toBe(false);
    }
  });
  it('la preuve interne est séparée du domaine public et ne dépend pas d’une session', () => {
    const binding = internalOrderAdmissionBinding('staff', TENANT, body);
    expect(binding).toEqual(internalOrderAdmissionBinding('staff', TENANT, structuredClone(body)));
    expect(binding.kind).toBe('staff');
    expect(binding.proofHash).not.toBe(publicRecoveryBinding(TENANT, publicBody)!.proofHash);
    expect(binding.proofHash).not.toContain('0612345678');
    expect(binding.proofHash).not.toBe(internalOrderAdmissionBinding('staff', 'other', body).proofHash);
  });
  it('les empreintes figent tout le corps métier, sans dépendre de l’ordre des clés', () => {
    const binding = internalOrderAdmissionBinding('staff', TENANT, body);
    expect(internalOrderAdmissionBinding('staff', TENANT, { ...body, pickup: {
      customerPhone: body.pickup!.customerPhone, customerName: body.pickup!.customerName, slot: body.pickup!.slot,
    } })).toEqual(binding);
    for (const update of [{ note: 'Autre commande' }, { lines: [{ ...body.lines[0]!, qty: 2 }] },
      { payment: { method: 'online' as const } }, { pickup: { ...body.pickup!, slot: '2030-05-02T16:30:00.000Z' } }]) {
      expect(internalOrderAdmissionBinding('staff', TENANT, { ...body, ...update }).payloadHash).not.toBe(binding.payloadHash);
    }
  });
  it.each(['pos', 'phone'] as const)('autorise le canal authentifié %s uniquement dans staff', (channel) => {
    expect(internalOrderAdmissionBinding('staff', TENANT, { ...body, channel }).kind).toBe('staff');
    expect(() => internalOrderAdmissionBinding('legacy', TENANT, { ...body, channel })).toThrow();
  });
  it('réserve legacy à online, sans jamais inventer de preuve publique', () => {
    const legacy = internalOrderAdmissionBinding('legacy', TENANT, { ...body, channel: 'online' });
    expect(legacy.kind).toBe('legacy');
    expect(() => internalOrderAdmissionBinding('staff', TENANT, { ...body, channel: 'online' })).toThrow();
    expect(publicRecoveryOfAdmission(legacy)).toBeNull();
    expect(publicRecoveryOfAdmission(internalOrderAdmissionBinding('staff', TENANT, body))).toBeNull();
  });
  it('ne sérialise dans Order que la preuve publique, jamais le propriétaire/kind', () => {
    const binding = publicRecoveryBinding(TENANT, publicBody)!;
    expect(publicRecoveryOfAdmission({ ...binding, kind: 'public', validationOwner: 'private' })).toEqual(binding);
  });
  it('authentifie les anciennes preuves C01 sans exiger de migration de kind', () => {
    const binding = publicRecoveryBinding(TENANT, publicBody)!;
    expect(() => assertOrderAdmissionBinding(binding, binding)).not.toThrow();
    expect(() => assertOrderAdmissionBinding({ ...binding, kind: 'public' }, binding)).not.toThrow();
  });
  it.each(['public', 'legacy', 'staff'] as const)('une collision de hash ne permet pas de changer de writer %s', (kind) => {
    const binding = { ...publicRecoveryBinding(TENANT, publicBody)!, kind, channel: kind === 'staff' ? 'phone' as const : 'online' as const };
    expect(() => assertOrderAdmissionBinding(binding, binding)).not.toThrow();
    for (const other of ['public', 'legacy', 'staff'].filter((entry) => entry !== kind)) {
      expect(() => assertOrderAdmissionBinding({ ...binding, kind: other }, binding)).toThrow('Commande introuvable');
    }
  });
  it.each(['pos', 'phone'] as const)('le canal staff %s est lié, pas simplement sa famille', (channel) => {
    const binding = internalOrderAdmissionBinding('staff', TENANT, { ...body, channel });
    expect(() => assertOrderAdmissionBinding(binding, binding)).not.toThrow();
    for (const other of [undefined, 'online', channel === 'phone' ? 'pos' : 'phone']) {
      expect(() => assertOrderAdmissionBinding({ ...binding, channel: other }, binding)).toThrow('Commande introuvable');
    }
  });
  it('refuse kind invalide, preuve ou payload modifiés', () => {
    const binding = internalOrderAdmissionBinding('staff', TENANT, body);
    for (const update of [{ kind: null }, { kind: 'historical' }, { proofHash: '0'.repeat(64) }, { payloadHash: '0'.repeat(64) }]) {
      expect(() => assertOrderAdmissionBinding({ ...binding, ...update }, binding)).toThrow('Commande introuvable');
    }
  });
});
