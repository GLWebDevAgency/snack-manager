import { describe, expect, it } from 'vitest';
import { SiteLeadCreateSchema } from './crm';

describe('SiteLeadCreateSchema', () => {
  const valid = {
    name: 'Karim B.',
    restaurant: 'Class Food',
    phone: '+33 6 12 34 56 78',
    email: null,
    callbackSlot: 'entre-services',
    message: 'Deux caisses et un gros rush le midi.',
    platforms: true,
    source: 'site-vitrine',
  } as const;

  it('accepte uniquement la forme publique utile au rappel', () => {
    expect(SiteLeadCreateSchema.parse(valid)).toEqual(valid);
  });

  it('borne tous les champs libres avant leur stockage CRM', () => {
    expect(() => SiteLeadCreateSchema.parse({ ...valid, name: 'x'.repeat(121) })).toThrow();
    expect(() => SiteLeadCreateSchema.parse({ ...valid, restaurant: 'x'.repeat(161) })).toThrow();
    expect(() => SiteLeadCreateSchema.parse({ ...valid, message: 'x'.repeat(2_001) })).toThrow();
  });

  it('refuse un faux téléphone, un créneau inventé et une source contrôlée par le client', () => {
    expect(() => SiteLeadCreateSchema.parse({ ...valid, phone: '=cmd' })).toThrow();
    expect(() => SiteLeadCreateSchema.parse({ ...valid, callbackSlot: 'minuit' })).toThrow();
    expect(() => SiteLeadCreateSchema.parse({ ...valid, source: 'partenaire-premium' })).toThrow();
  });

  it('autorise un restaurant, un e-mail et un message absents', () => {
    expect(
      SiteLeadCreateSchema.parse({
        ...valid,
        restaurant: null,
        email: null,
        message: null,
        platforms: false,
      }),
    ).toMatchObject({ restaurant: null, email: null, message: null, platforms: false });
  });
});
