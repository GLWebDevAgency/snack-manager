import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import type { Lead } from '@sm/db';
import type { Model } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactMailer } from '../../infrastructure/contact/contact-mailer';
import { CONTACT_MAX_ATTEMPTS, CONTACT_RETRY_WINDOW_MS, ContactNotificationProcessor, contactRetryDelayMs } from './contact-notification.processor';

const NOW = new Date('2026-09-20T10:00:00.000Z');
const REQUEST_ID = 'ba59d765-e641-4229-a846-e09f36c7a7a6';
const LEASE = '57c4a490-87a4-4188-baaa-e12d95a8a41c';
const PRIVATE_MARKER = 'adresse-confidentielle@example.invalid';
function claimed(attempts = 1) {
  return {
    _id: '65f000000000000000000099', siteRequestId: REQUEST_ID, createdAt: NOW,
    siteRequest: { name: 'Prospect Test', restaurant: 'Restaurant Test', phone: '+33 6 00 00 00 00',
      email: PRIVATE_MARKER, need: 'menu-tv', callbackSlot: 'matin', message: 'Bonjour', platforms: false },
    contactNotification: { attempts, firstAttemptAt: attempts === 1 ? null : NOW,
      state: 'processing', leaseToken: LEASE, leaseUntil: new Date(NOW.getTime() + 60_000) },
  };
}
function harness(claims: unknown[] = [claimed(), null], enabled = true) {
  const findOneAndUpdate = vi.fn(() => ({
    select: vi.fn(() => ({ lean: async () => claims.shift() ?? null })),
  }));
  const model = {
    findOneAndUpdate,
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const send = vi.fn().mockResolvedValue({ accepted: true, messageId: '<test-message>' });
  const mailer = { enabled, providerName: 'test', crmUrl: null, send } as ContactMailer;
  const processor = new ContactNotificationProcessor(model as unknown as Model<Lead>, mailer);
  return { processor, model, send, mailer };
}

describe('ContactNotificationProcessor', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('ne consomme aucun essai si le canal n’est pas configuré', async () => {
    const f = harness([], false);
    expect(await f.processor.drain()).toEqual({ claimed: 0, accepted: 0, retried: 0, failed: 0 });
    expect(f.model.findOneAndUpdate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it('réclame atomiquement une intention puis marque uniquement l’acceptation fournisseur', async () => {
    const f = harness();
    expect(await f.processor.drain()).toEqual({ claimed: 1, accepted: 1, retried: 0, failed: 0 });
    expect(f.model.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      'contactNotification.state': 'pending',
      'contactNotification.attempts': { $lt: CONTACT_MAX_ATTEMPTS },
    }), expect.objectContaining({
      $set: expect.objectContaining({ 'contactNotification.state': 'processing',
        'contactNotification.leaseToken': expect.stringMatching(/^[0-9a-f-]{36}$/) }),
      $inc: { 'contactNotification.attempts': 1 },
    }), expect.objectContaining({ timestamps: false, new: true }));
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]?.[0]).toMatchObject({ requestId: REQUEST_ID });
    expect(f.model.updateOne).toHaveBeenLastCalledWith({
      _id: claimed()._id, 'contactNotification.state': 'processing', 'contactNotification.leaseToken': LEASE,
    }, { $set: expect.objectContaining({
      'contactNotification.state': 'accepted', 'contactNotification.providerMessageId': '<test-message>',
      'contactNotification.acceptedAt': NOW,
    }) }, { timestamps: false });
    for (const call of f.model.updateMany.mock.calls) expect(call[2]).toEqual({ timestamps: false });
  });

  it('reprend une panne avec le même identifiant fournisseur sans journaliser la PII', async () => {
    const f = harness([claimed(), null, claimed(2), null]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    f.send.mockRejectedValueOnce(new Error(PRIVATE_MARKER));
    expect(await f.processor.drain()).toMatchObject({ retried: 1 });
    expect(f.model.updateOne).toHaveBeenLastCalledWith(expect.anything(), { $set: expect.objectContaining({
      'contactNotification.state': 'pending', 'contactNotification.lastError': 'provider_unavailable',
      'contactNotification.nextAttemptAt': new Date(NOW.getTime() + 30_000),
    }) }, { timestamps: false });
    expect(await f.processor.drain()).toMatchObject({ accepted: 1 });
    expect(f.send.mock.calls[0]?.[0]).toEqual(f.send.mock.calls[1]?.[0]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(f.model.updateOne.mock.calls)).not.toContain(PRIVATE_MARKER);
  });

  it('termine après six essais et conserve le lead avec une erreur codée', async () => {
    const f = harness([claimed(CONTACT_MAX_ATTEMPTS), null]);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    f.send.mockResolvedValue({ accepted: false, retryable: true, code: 'provider_unavailable' });
    expect(await f.processor.drain()).toMatchObject({ failed: 1, retried: 0 });
    expect(f.model.updateOne).toHaveBeenLastCalledWith(expect.anything(), { $set: expect.objectContaining({
      'contactNotification.state': 'failed', 'contactNotification.nextAttemptAt': null,
    }) }, { timestamps: false });
  });

  it('récupère les baux expirés sans remettre à zéro le budget et exclut les anciennes tentatives', async () => {
    const f = harness([]);
    await f.processor.drain();
    expect(f.model.updateMany).toHaveBeenNthCalledWith(1, { $and: [expect.anything(), { $or: [
      { 'contactNotification.attempts': { $gte: CONTACT_MAX_ATTEMPTS } },
      { 'contactNotification.firstAttemptAt': {
        $lte: new Date(NOW.getTime() - CONTACT_RETRY_WINDOW_MS), $ne: null,
      } },
    ] }] }, { $set: expect.objectContaining({ 'contactNotification.state': 'failed' }) }, { timestamps: false });
    expect(f.model.updateMany).toHaveBeenNthCalledWith(2, {
      'contactNotification.state': 'processing', 'contactNotification.leaseUntil': { $lte: NOW },
    }, { $set: expect.objectContaining({
      'contactNotification.state': 'pending', 'contactNotification.lastError': 'lease_expired',
    }) }, { timestamps: false });
    for (const [, update] of f.model.updateMany.mock.calls) {
      expect(update.$set).not.toHaveProperty('contactNotification.attempts');
    }
  });

  it('un CAS perdu avant le premier envoi ne déclenche aucun message', async () => {
    const f = harness();
    f.model.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(await f.processor.drain()).toMatchObject({ accepted: 0, failed: 0 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('un CAS perdu après l’envoi ne prétend pas avoir enregistré l’acceptation', async () => {
    const f = harness([claimed(2), null]);
    f.model.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(await f.processor.drain()).toMatchObject({ accepted: 0 });
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.model.updateOne.mock.calls[0]?.[0]).toMatchObject({ 'contactNotification.leaseToken': LEASE });
  });

  it('une seconde boucle locale ne chevauche pas l’envoi déjà en cours', async () => {
    const f = harness();
    let release!: () => void;
    f.send.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ accepted: true, messageId: '<done>' });
    }));
    const first = f.processor.drain();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    expect(await f.processor.drain()).toMatchObject({ claimed: 0 });
    release();
    expect(await first).toMatchObject({ accepted: 1 });
  });

  it('le backoff est borné à huit minutes', () => {
    expect(contactRetryDelayMs(1)).toBe(30_000);
    expect(contactRetryDelayMs(6)).toBe(480_000);
    expect(contactRetryDelayMs(1_000)).toBe(480_000);
  });
});
