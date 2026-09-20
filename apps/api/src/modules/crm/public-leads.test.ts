import 'reflect-metadata';
import {
  NotFoundException,
  ServiceUnavailableException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC } from '../../common/auth';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { ContactIngestGuard } from './contact-ingest.guard';
import { PublicLeadsController } from './public-leads.controller';
import type { ContactIntakeService } from './contact-intake.service';

const BODY = {
  requestId: 'ba59d765-e641-4229-a846-e09f36c7a7a6',
  name: 'Karim B.',
  restaurant: 'Class Food',
  phone: '+33 6 12 34 56 78',
  email: 'karim@example.com',
  callbackSlot: 'entre-services',
  message: 'Deux caisses, gros rush le midi.',
  platforms: true,
  source: 'site-vitrine',
} as const;

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

function guard(expected?: string) {
  const config = { get: vi.fn().mockReturnValue(expected) } as unknown as ConfigService;
  return new ContactIngestGuard(config);
}

function harness(options: { quota?: boolean; quotaError?: Error } = {}) {
  const createLead = vi.fn().mockResolvedValue({ ok: true, stored: true, requestId: BODY.requestId });
  const reserve = options.quotaError
    ? vi.fn().mockRejectedValue(options.quotaError)
    : vi.fn().mockResolvedValue(options.quota ?? true);
  const controller = new PublicLeadsController(
    { create: createLead } as unknown as ContactIntakeService,
    { reserve } as unknown as SharedPublicQuota,
  );
  return { controller, createLead, reserve };
}

describe('ContactIngestGuard', () => {
  it('accepte uniquement le secret serveur-à-serveur exact', () => {
    expect(guard('secret-long').canActivate(context('Bearer secret-long'))).toBe(true);
    expect(() => guard('secret-long').canActivate(context('Bearer secret-faux'))).toThrow(
      NotFoundException,
    );
    expect(() => guard('secret-long').canActivate(context())).toThrow(NotFoundException);
  });

  it("ferme la route quand le secret n'est pas configuré", () => {
    expect(() => guard(undefined).canActivate(context('Bearer nimporte-quoi'))).toThrow(
      NotFoundException,
    );
  });
});

describe('PublicLeadsController', () => {
  it('est public pour le guard JWT, mais possède sa garde serveur dédiée', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, PublicLeadsController)).toBe(true);
    const guards = Reflect.getMetadata('__guards__', PublicLeadsController) as unknown[];
    expect(guards).toContain(ContactIngestGuard);
  });

  it('transforme le formulaire en lead CRM durable sans donner de droits CRM au visiteur', async () => {
    const { controller, createLead, reserve } = harness();

    await expect(controller.create(BODY)).resolves.toEqual({ ok: true, stored: true, requestId: BODY.requestId });

    expect(reserve).toHaveBeenCalledWith({
      scope: 'contact-leads',
      clientKey: 'site-vitrine',
      windowMs: 600_000,
      clientLimit: 30,
      globalLimit: 30,
    });
    expect(createLead).toHaveBeenCalledWith(BODY);
  });

  it('transmet aussi les anciennes demandes sans e-mail ni message', async () => {
    const { controller, createLead } = harness();
    await controller.create({ ...BODY, restaurant: null, email: null, message: null });
    expect(createLead.mock.calls[0]?.[0]).toMatchObject({
      restaurant: null, email: null, message: null,
    });
  });

  it('refuse avant Mongo quand le plafond partagé est atteint', async () => {
    const { controller, createLead } = harness({ quota: false });
    await expect(controller.create(BODY)).rejects.toMatchObject({ status: 429 });
    expect(createLead).not.toHaveBeenCalled();
  });

  it('échoue fermé sans écrire si Redis est indisponible', async () => {
    const { controller, createLead } = harness({ quotaError: new Error('redis down') });
    await expect(controller.create(BODY)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(createLead).not.toHaveBeenCalled();
  });
});
