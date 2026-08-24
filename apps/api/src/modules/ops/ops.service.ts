import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  ErrorReport,
  ErrorSource,
  FunnelEvent as FunnelEventBody,
  OpsErrorGroup,
  OpsFunnelRow,
} from '@sm/contracts';
import type { ErrorEvent, FunnelEvent } from '@sm/db';
import { composeFunnel } from './funnel-compose';
import { ERROR_FORWARDER, type ErrorForwarder } from '../../infrastructure/alerts/error-forwarder';
import { errorFingerprint } from './fingerprint';

/**
 * Le journal d'erreurs de la plateforme — écrit par tout le monde, lu par
 * l'équipe sur /sm/erreurs.
 *
 * Trois entrées possibles : le filtre d'exceptions de l'API (source 'api'),
 * le guichet public des interfaces (web/pos/kds), et les services qui
 * constatent une dégradation qu'aucune exception ne porte (Stripe qui bascule
 * au comptoir, par exemple) — pour eux, `record` s'appelle directement.
 *
 * Deux invariants :
 * - `record` NE LÈVE JAMAIS : un journal qui fait tomber ce qu'il journalise
 *   serait pire que pas de journal. L'échec d'écriture part en console, seule
 *   trace possible quand la base elle-même est la panne.
 * - une empreinte = un document (upsert + $inc) : l'avalanche incrémente, elle
 *   n'insère pas.
 */

@Injectable()
export class OpsService {
  private readonly forwarder: ErrorForwarder | null;

  constructor(
    @InjectModel('ErrorEvent') private readonly errors: Model<ErrorEvent>,
    @InjectModel('FunnelEvent') private readonly funnel: Model<FunnelEvent>,
    // Optionnel deux fois : au sens de Nest (les tests construisent sans lui)
    // et au sens du produit (sans SENTRY_DSN, le relais est un noop).
    @Optional() @Inject(ERROR_FORWARDER) forwarder?: ErrorForwarder,
  ) {
    this.forwarder = forwarder?.enabled ? forwarder : null;
  }

  /** Un jalon du tunnel — même contrat que `record` : n'échoue JAMAIS. */
  async recordFunnel(event: FunnelEventBody, now: Date = new Date()): Promise<void> {
    try {
      await this.funnel.create({ ...event, at: now });
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.error('jalon de tunnel perdu :', cause);
    }
  }

  /** L'entonnoir par établissement sur la fenêtre demandée. */
  async funnelRows(days = 30, now: Date = new Date()): Promise<OpsFunnelRow[]> {
    const floor = new Date(now.getTime() - days * 86_400_000);
    const rows = await this.funnel.aggregate<{ _id: { slug: string; step: string }; n: number }>([
      { $match: { at: { $gte: floor } } },
      { $group: { _id: { slug: '$slug', step: '$step' }, n: { $sum: 1 } } },
    ]);
    return composeFunnel(rows.map((r) => ({ slug: r._id.slug, step: r._id.step, n: r.n })));
  }

  async record(entry: ErrorReport, now: Date = new Date()): Promise<void> {
    try {
      this.forwarder?.forward(entry);
      const hash = errorFingerprint(entry.source, entry.message, entry.stack ?? '');
      await this.errors.updateOne(
        { source: entry.source, hash },
        {
          $inc: { count: 1 },
          // Le groupe garde la DERNIÈRE occurrence : c'est elle qu'on débogue.
          $set: {
            message: entry.message.slice(0, 500),
            stack: (entry.stack ?? '').slice(0, 6_000),
            url: (entry.url ?? '').slice(0, 300),
            appVersion: (entry.appVersion ?? '').slice(0, 40),
            lastAt: now,
          },
          $setOnInsert: { firstAt: now, seenAt: null },
        },
        { upsert: true },
      );
    } catch (cause) {
      // eslint-disable-next-line no-console
      console.error('journal d’erreurs indisponible :', cause);
    }
  }

  /** Les groupes, jamais vues d'abord (`null` trie avant toute date), puis les
   *  plus récents. L'écran n'a pas besoin de plus de 120 lignes. */
  async recentGroups(limit = 120): Promise<OpsErrorGroup[]> {
    const docs = await this.errors.find({}).sort({ seenAt: 1, lastAt: -1 }).limit(limit).lean();
    return docs.map((d) => ({
      _id: String(d._id),
      source: d.source as ErrorSource,
      message: d.message,
      count: d.count ?? 1,
      firstAt: iso(d.firstAt) ?? new Date(0).toISOString(),
      lastAt: iso(d.lastAt) ?? new Date(0).toISOString(),
      seenAt: iso(d.seenAt),
      stack: d.stack ?? '',
      url: d.url ?? '',
      appVersion: d.appVersion ?? '',
    }));
  }

  async markSeen(id: string, now: Date = new Date()): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Groupe introuvable');
    const doc = await this.errors.findByIdAndUpdate(id, { $set: { seenAt: now } }).lean();
    if (!doc) throw new NotFoundException('Groupe introuvable');
  }

  /** Les groupes jamais vus apparus depuis `sinceMs` — la matière du veilleur. */
  async freshUnseen(sinceMs: number, now: Date = new Date()): Promise<OpsErrorGroup[]> {
    const docs = await this.errors
      .find({ seenAt: null, lastAt: { $gte: new Date(now.getTime() - sinceMs) } })
      .sort({ lastAt: -1 })
      .limit(20)
      .lean();
    return docs.map((d) => ({
      _id: String(d._id),
      source: d.source as ErrorSource,
      message: d.message,
      count: d.count ?? 1,
      firstAt: iso(d.firstAt) ?? new Date(0).toISOString(),
      lastAt: iso(d.lastAt) ?? new Date(0).toISOString(),
      seenAt: null,
      stack: d.stack ?? '',
      url: d.url ?? '',
      appVersion: d.appVersion ?? '',
    }));
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
