import { describe, expect, it } from 'vitest';
import { AlertLogSchema, ErrorEventSchema, FunnelEventSchema } from './schemas';

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

function ttl(schema: typeof ErrorEventSchema, field: string) {
  return schema
    .indexes()
    .find(([keys]) => Object.keys(keys).length === 1 && keys[field] === 1)?.[1]
    ?.expireAfterSeconds;
}

describe('rétention des écritures publiques et de leurs alertes', () => {
  it('expire les erreurs 90 jours après leur dernière occurrence', () => {
    expect(ttl(ErrorEventSchema, 'lastAt')).toBe(NINETY_DAYS_SECONDS);
  });

  it('expire les jalons anonymes du funnel après 90 jours', () => {
    expect(ttl(FunnelEventSchema as typeof ErrorEventSchema, 'at')).toBe(NINETY_DAYS_SECONDS);
  });

  it("expire l'historique technique des alertes, sans toucher aux données CRM", () => {
    expect(ttl(AlertLogSchema as typeof ErrorEventSchema, 'sentAt')).toBe(NINETY_DAYS_SECONDS);
  });
});
