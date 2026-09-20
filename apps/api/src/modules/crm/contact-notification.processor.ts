import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SiteLeadCreateSchema } from '@sm/contracts';
import type { Lead } from '@sm/db';
import type { Model } from 'mongoose';
import { CONTACT_MAILER, type ContactMailer, type ContactMailResult } from '../../infrastructure/contact/contact-mailer';
import { composeContactEmail } from './contact-email';

const POLL_MS = 15_000;
const LEASE_MS = 60_000;
export const CONTACT_MAX_ATTEMPTS = 6;
// Marge sous les 30 minutes d'idempotence de Brevo. Après un arrêt prolongé,
// une réponse perdue reste à vérifier humainement, jamais renvoyée à l'aveugle.
export const CONTACT_RETRY_WINDOW_MS = 25 * 60_000;
const SELECTION = '+siteRequestId +siteRequest +contactNotification';

export function contactRetryDelayMs(attempt: number): number {
  return Math.min(480_000, 30_000 * 2 ** Math.max(0, Math.min(4, attempt - 1)));
}

type Notification = NonNullable<Lead['contactNotification']>;
type ClaimedLead = Pick<Lead, 'siteRequestId' | 'siteRequest' | 'createdAt'> & {
  _id: unknown; contactNotification: Notification;
};
export type ContactDrain = { claimed: number; accepted: number; retried: number; failed: number };

@Injectable()
export class ContactNotificationProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ContactNotificationProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRun: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    @Inject(CONTACT_MAILER) private readonly mailer: ContactMailer,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    if (!this.mailer.enabled) {
      this.logger.warn('Notifications contact non configurées ; les demandes restent enregistrées en attente.');
      return;
    }
    const run = () => void this.drain().catch(() => {
      this.logger.warn('Notifications contact : stockage momentanément indisponible.');
    });
    this.timer = setInterval(run, POLL_MS);
    this.timer.unref();
    this.firstRun = setTimeout(run, 2_000);
    this.firstRun.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRun) clearTimeout(this.firstRun);
    this.timer = null;
    this.firstRun = null;
  }

  async drain(): Promise<ContactDrain> {
    const result: ContactDrain = { claimed: 0, accepted: 0, retried: 0, failed: 0 };
    if (this.draining || !this.mailer.enabled) return result;
    this.draining = true;
    try {
      await this.recover(new Date());
      for (let index = 0; index < 10; index += 1) {
        const now = new Date();
        const lead = await this.leads.findOneAndUpdate({
          'contactNotification.state': 'pending',
          'contactNotification.attempts': { $lt: CONTACT_MAX_ATTEMPTS },
          'contactNotification.nextAttemptAt': { $lte: now },
          $or: [
            { 'contactNotification.firstAttemptAt': null },
            { 'contactNotification.firstAttemptAt': { $gt: new Date(now.getTime() - CONTACT_RETRY_WINDOW_MS) } },
          ],
        }, {
          $set: {
            'contactNotification.state': 'processing',
            'contactNotification.leaseToken': randomUUID(),
            'contactNotification.leaseUntil': new Date(now.getTime() + LEASE_MS),
          },
          $inc: { 'contactNotification.attempts': 1 },
        }, { new: true, sort: { createdAt: 1 }, timestamps: false })
          .select(SELECTION).lean() as ClaimedLead | null;
        if (!lead) break;
        result.claimed += 1;
        const outcome = await this.process(lead, now);
        if (outcome) result[outcome] += 1;
      }
      return result;
    } finally { this.draining = false; }
  }

  private async recover(now: Date): Promise<void> {
    // Récupérer seulement les baux expirés ; une autre réplique en train
    // d'envoyer reste propriétaire de sa transition finale.
    const eligible = { $or: [
      { 'contactNotification.state': 'pending' },
      { 'contactNotification.state': 'processing', 'contactNotification.leaseUntil': { $lte: now } },
    ] };
    await this.leads.updateMany({ $and: [eligible, { $or: [
      { 'contactNotification.attempts': { $gte: CONTACT_MAX_ATTEMPTS } },
      { 'contactNotification.firstAttemptAt': { $lte: new Date(now.getTime() - CONTACT_RETRY_WINDOW_MS), $ne: null } },
    ] }] }, { $set: {
      'contactNotification.state': 'failed',
      'contactNotification.lastError': 'retry_budget_exhausted',
      'contactNotification.nextAttemptAt': null,
      'contactNotification.leaseToken': null,
      'contactNotification.leaseUntil': null,
    } }, { timestamps: false });
    await this.leads.updateMany({
      'contactNotification.state': 'processing', 'contactNotification.leaseUntil': { $lte: now },
    }, { $set: {
      'contactNotification.state': 'pending',
      'contactNotification.nextAttemptAt': now,
      'contactNotification.lastError': 'lease_expired',
      'contactNotification.leaseToken': null,
      'contactNotification.leaseUntil': null,
    } }, { timestamps: false });
  }

  private lease(lead: ClaimedLead) {
    return {
      _id: lead._id,
      'contactNotification.state': 'processing',
      'contactNotification.leaseToken': lead.contactNotification.leaseToken,
    };
  }

  private async process(lead: ClaimedLead, now: Date): Promise<'accepted' | 'retried' | 'failed' | null> {
    if (!lead.contactNotification.firstAttemptAt) {
      const claimed = await this.leads.updateOne(this.lease(lead), {
        $set: { 'contactNotification.firstAttemptAt': now },
      }, { timestamps: false });
      if (claimed.modifiedCount !== 1) return null;
    }
    const request = SiteLeadCreateSchema.safeParse({
      ...lead.siteRequest, requestId: lead.siteRequestId, source: 'site-vitrine',
    });
    let outcome: ContactMailResult;
    if (!request.success || !request.data.requestId) {
      outcome = { accepted: false, retryable: false, code: 'provider_rejected' };
    } else {
      try {
        outcome = await this.mailer.send(composeContactEmail(
          { ...request.data, requestId: request.data.requestId }, lead.createdAt, this.mailer.crmUrl,
        ));
      } catch {
        outcome = { accepted: false, retryable: true, code: 'provider_unavailable' };
      }
    }
    const finishedAt = new Date();
    const retry = !outcome.accepted && outcome.retryable
      && lead.contactNotification.attempts < CONTACT_MAX_ATTEMPTS;
    const state = outcome.accepted ? 'accepted' : retry ? 'pending' : 'failed';
    const saved = await this.leads.updateOne(this.lease(lead), { $set: {
      'contactNotification.state': state,
      'contactNotification.acceptedAt': outcome.accepted ? finishedAt : null,
      'contactNotification.providerMessageId': outcome.accepted ? outcome.messageId : null,
      'contactNotification.lastError': outcome.accepted ? null : outcome.code,
      'contactNotification.nextAttemptAt': retry
        ? new Date(finishedAt.getTime() + contactRetryDelayMs(lead.contactNotification.attempts)) : null,
      'contactNotification.leaseToken': null,
      'contactNotification.leaseUntil': null,
    } }, { timestamps: false });
    if (saved.modifiedCount !== 1) return null;
    if (state === 'failed') this.logger.warn('Notification contact en échec ; demande conservée dans le CRM.');
    return outcome.accepted ? 'accepted' : retry ? 'retried' : 'failed';
  }
}
