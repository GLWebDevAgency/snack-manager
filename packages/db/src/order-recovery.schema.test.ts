import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

describe('preuve privée de reprise de commande', () => {
  it('ne fabrique aucune preuve pour une commande historique', () => {
    const db = new Mongoose();
    const Order = db.model('RecoveryLegacy', OrderSchema.clone());
    expect(new Order().get('publicRecovery')).toBeNull();
  });
  it('cache les empreintes même juste après insertion et sans projection Mongo', () => {
    const db = new Mongoose();
    const Order = db.model('RecoveryPrivacy', OrderSchema.clone());
    const document = new Order({ publicRecovery: { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) } });
    expect(document.get('publicRecovery.proofHash')).toBe('a'.repeat(64));
    expect(document.toObject()).not.toHaveProperty('publicRecovery');
    expect(document.toJSON()).not.toHaveProperty('publicRecovery');
    expect(JSON.stringify(document)).not.toContain('proofHash');
    expect(OrderSchema.path('publicRecovery').options.select).toBe(false);
  });
  it.each(['short', 'a'.repeat(63), 'g'.repeat(64)])('refuse une empreinte malformée %s', (proofHash) => {
    const db = new Mongoose();
    const Order = db.model('RecoveryMalformed', OrderSchema.clone());
    const document = new Order({ publicRecovery: { version: 1, proofHash, payloadHash: 'b'.repeat(64) } });
    expect(document.validateSync()?.errors['publicRecovery.proofHash']).toBeDefined();
  });
});
