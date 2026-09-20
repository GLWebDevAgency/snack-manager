import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SiteLeadCreateSchema, type SiteLeadAccepted, type SiteLeadCreate } from '@sm/contracts';
import type { Lead } from '@sm/db';
import type { Model } from 'mongoose';
import { contactLeadNotes } from './contact-email';

/** Le lead et son intention d'e-mail sont UNE écriture, jamais deux promesses. */
@Injectable()
export class ContactIntakeService {
  private indexReady: Promise<unknown> | null = null;

  constructor(@InjectModel('Lead') private readonly leads: Model<Lead>) {}

  private async ensureUniqueIndex(): Promise<void> {
    // Auto-index n'est pas une barrière : attendre cet index précis avant la
    // première requête évite la course au premier déploiement. Aucun drop/sync.
    this.indexReady ??= this.leads.collection.createIndex({ siteRequestId: 1 }, {
      name: 'site_request_id_unique', unique: true,
      partialFilterExpression: { siteRequestId: { $type: 'string' } },
    }).catch(() => {
      this.indexReady = null;
      throw new ServiceUnavailableException('Enregistrement momentanément indisponible.');
    });
    await this.indexReady;
  }

  async create(input: SiteLeadCreate): Promise<SiteLeadAccepted> {
    const body = SiteLeadCreateSchema.parse(input);
    const requestId = body.requestId ?? randomUUID();
    const storageKey = requestId.toLowerCase();
    const siteRequest = {
      name: body.name, restaurant: body.restaurant, phone: body.phone,
      email: body.email, need: body.need ?? null, callbackSlot: body.callbackSlot,
      message: body.message, platforms: body.platforms,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(siteRequest)).digest('hex');
    await this.ensureUniqueIndex();
    try {
      await this.leads.create({
        restaurantName: body.restaurant ?? 'Restaurant à qualifier',
        contact: { name: body.name, phone: body.phone, email: body.email ?? '' },
        stage: 'nouveau', sequence: null, founderSeatReserved: false,
        notes: contactLeadNotes(body), touches: [],
        siteRequestId: storageKey, siteRequestFingerprint: fingerprint, siteRequest,
        contactNotification: { state: 'pending', attempts: 0, nextAttemptAt: new Date() },
      });
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 11000) {
        throw new ServiceUnavailableException('Enregistrement momentanément indisponible.');
      }
      const existing = await this.leads.findOne({ siteRequestId: storageKey })
        .select('+siteRequestFingerprint').lean();
      if (!existing) throw new ServiceUnavailableException('Enregistrement momentanément indisponible.');
      if (existing.siteRequestFingerprint !== fingerprint) {
        throw new ConflictException('Cette référence correspond déjà à une autre demande.');
      }
    }
    // La réussite porte sur la sauvegarde. Le worker possède seul l'état
    // d'envoi et aucune dépendance e-mail ne peut faire perdre cette demande.
    return { ok: true, stored: true, requestId };
  }
}
