import 'reflect-metadata';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Lead } from '@sm/db';
import type { Model } from 'mongoose';
import { LeadCreateSchema, LeadUpdateSchema } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ContactIntakeService } from './contact-intake.service';

const BODY = {
  requestId: 'ba59d765-e641-4229-a846-e09f36c7a7a6',
  name: 'Nora Test', restaurant: 'Restaurant Test', phone: '+33 6 00 00 00 00',
  email: 'nora@example.invalid', need: 'menu-tv', callbackSlot: 'entre-services',
  message: 'Faire évoluer notre carte.', platforms: true, source: 'site-vitrine',
} as const;

function harness() {
  const documents = new Map<string, Record<string, unknown>>();
  const createIndex = vi.fn().mockResolvedValue('site_request_id_unique');
  const create = vi.fn(async (doc: Record<string, unknown>) => {
    const key = String(doc.siteRequestId);
    if (documents.has(key)) throw { code: 11000 };
    documents.set(key, doc);
    return doc;
  });
  const findOne = vi.fn((filter: { siteRequestId: string }) => ({
    select: vi.fn(() => ({ lean: async () => documents.get(filter.siteRequestId) ?? null })),
  }));
  const model = { collection: { createIndex }, create, findOne } as unknown as Model<Lead>;
  return { service: new ContactIntakeService(model), createIndex, create, documents, findOne };
}

describe('ContactIntakeService', () => {
  it('sauve le lead, le snapshot complet et l’intention pending dans une seule écriture', async () => {
    const f = harness();
    await expect(f.service.create(BODY)).resolves.toEqual({ ok: true, stored: true, requestId: BODY.requestId });
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.documents.get(BODY.requestId)).toMatchObject({
      restaurantName: BODY.restaurant, contact: { name: BODY.name, phone: BODY.phone, email: BODY.email },
      stage: 'nouveau', founderSeatReserved: false,
      siteRequest: { need: 'menu-tv', callbackSlot: 'entre-services', message: BODY.message },
      contactNotification: { state: 'pending', attempts: 0 },
    });
    expect(f.documents.get(BODY.requestId)?.notes).toContain('Préparer mes menus TV');
  });

  it('attend l’index unique avant toute écriture et échoue fermé si sa création échoue', async () => {
    const f = harness();
    let ready!: () => void;
    f.createIndex.mockReturnValue(new Promise<void>((resolve) => { ready = resolve; }));
    const pending = f.service.create(BODY);
    await Promise.resolve();
    expect(f.create).not.toHaveBeenCalled();
    ready();
    await pending;
    expect(f.createIndex).toHaveBeenCalledWith({ siteRequestId: 1 }, expect.objectContaining({
      unique: true, partialFilterExpression: { siteRequestId: { $type: 'string' } },
    }));
    const broken = harness();
    broken.createIndex.mockRejectedValue(new Error('unavailable'));
    await expect(broken.service.create(BODY)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(broken.create).not.toHaveBeenCalled();
  });

  it('deux reprises concurrentes conservent un seul lead et la même référence', async () => {
    const f = harness();
    const results = await Promise.all([f.service.create(BODY), f.service.create(BODY)]);
    expect(results[0]).toEqual(results[1]);
    expect(f.documents.size).toBe(1);
    expect(f.createIndex).toHaveBeenCalledOnce();
  });

  it('refuse la réutilisation du même UUID pour un contenu différent', async () => {
    const f = harness();
    await f.service.create(BODY);
    await expect(f.service.create({ ...BODY, message: 'Autre projet' })).rejects.toBeInstanceOf(ConflictException);
    expect(f.documents.size).toBe(1);
    expect(f.documents.get(BODY.requestId)?.siteRequest).toMatchObject({ message: BODY.message });
  });

  it('garde la compatibilité des anciennes vitrines sans référence ni besoin séparé', async () => {
    const f = harness();
    const { requestId: _id, need: _need, ...old } = BODY;
    const accepted = await f.service.create({ ...old, email: null, restaurant: null });
    expect(accepted.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.documents.get(accepted.requestId)).toMatchObject({
      restaurantName: 'Restaurant à qualifier', contact: { email: '' }, siteRequest: { need: null },
    });
  });

  it('ne confirme aucune sauvegarde quand Mongo échoue', async () => {
    const f = harness();
    f.create.mockRejectedValue(new Error(`Mongo failure ${BODY.email}`));
    await expect(f.service.create(BODY)).rejects.toMatchObject({ status: 503 });
    expect(f.documents.size).toBe(0);
  });

  it('conserve un message de 2 000 caractères et des notes encore modifiables dans le CRM', async () => {
    const f = harness();
    const message = 'x'.repeat(2_000);
    await f.service.create({ ...BODY, message });
    const lead = f.documents.get(BODY.requestId)!;
    expect(lead.notes).toContain(message);
    expect(LeadCreateSchema.safeParse(lead).success).toBe(true);
    expect(LeadUpdateSchema.safeParse({ notes: lead.notes }).success).toBe(true);
    expect(LeadUpdateSchema.safeParse({ notes: 'x'.repeat(4_097) }).success).toBe(false);
  });
});
