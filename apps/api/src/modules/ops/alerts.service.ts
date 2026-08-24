import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ERROR_SOURCE_LABELS } from '@sm/contracts';
import type { AlertLog } from '@sm/db';
import { TEAM_ALERTER } from '../../infrastructure/tokens';
import type { TeamAlerter } from '../../infrastructure/alerts/team-alerter';
import { SignalsService } from '../crm/signals.service';
import { OpsService } from './ops.service';
import { composeAlert, dueCandidates, type AlertCandidate } from './alerts-digest';

/**
 * LE VEILLEUR — la pièce qui manquait entre « c'est calculé » et « quelqu'un
 * le sait ».
 *
 * Toutes les cinq minutes : les signaux CRITIQUES de la file de travail
 * (caisse muette en plein service, impayé lourd, compte suspendu…) et les
 * groupes d'erreurs jamais vus apparus dans le quart d'heure partent en UN
 * message sur le canal configuré. La mémoire (`alertlogs`) garantit qu'une
 * même clé ne sonne pas plus d'une fois par refroidissement.
 *
 * Sans canal configuré, le veilleur ne se lance pas — et l'écran /sm/erreurs
 * l'affiche, plutôt que de laisser croire qu'une alerte partirait.
 */

const CHECK_INTERVAL_MS = 5 * 60_000;
/** Fenêtre de fraîcheur des erreurs : ce qui vient d'apparaître, pas l'stock. */
const FRESH_ERRORS_MS = 15 * 60_000;
/** Premier passage différé : l'API finit de démarrer avant de juger le parc. */
const FIRST_CHECK_DELAY_MS = 30_000;

@Injectable()
export class AlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly signals: SignalsService,
    private readonly ops: OpsService,
    @InjectModel('AlertLog') private readonly log: Model<AlertLog>,
    @Inject(TEAM_ALERTER) private readonly alerter: TeamAlerter,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.alerter.enabled) return;
    // Jamais sous test : un vitest qui monte le module ne doit pas sonner.
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const run = () => void this.check().catch(() => {});
    this.timer = setInterval(run, CHECK_INTERVAL_MS);
    this.timer.unref();
    setTimeout(run, FIRST_CHECK_DELAY_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** L'état du canal, pour l'écran /sm/erreurs. */
  status(): { providerName: string; enabled: boolean } {
    return { providerName: this.alerter.providerName, enabled: this.alerter.enabled };
  }

  /** Bouton « Tester le canal » : un envoi réel, la vérité en retour. */
  async test(): Promise<{ providerName: string; sent: boolean; reason?: string }> {
    const result = await this.alerter.send({
      title: 'Snack Manager — test du canal d’alerte',
      text: 'Si vous lisez ceci, le canal fonctionne. Rien à faire.',
    });
    return { providerName: this.alerter.providerName, ...result };
  }

  async check(now: Date = new Date()): Promise<{ sent: boolean; due: number }> {
    const [queue, erreurs] = await Promise.all([
      this.signals.queue(now),
      this.ops.freshUnseen(FRESH_ERRORS_MS, now),
    ]);

    const candidates: AlertCandidate[] = [
      ...queue
        .filter((s) => s.severity === 'critique')
        .map((s) => ({
          key: `signal:${s.id}`,
          line: `${s.tenantName} — ${s.title} : ${s.detail}`,
        })),
      ...erreurs.map((e) => ({
        key: `erreur:${e._id}`,
        line: `Erreur ${ERROR_SOURCE_LABELS[e.source]} ×${e.count} — ${e.message}`,
      })),
    ];
    if (candidates.length === 0) return { sent: false, due: 0 };

    const logged = await this.log
      .find({ key: { $in: candidates.map((c) => c.key) } })
      .lean();
    const lastSent = new Map(logged.map((l) => [l.key, new Date(l.sentAt)]));

    const due = dueCandidates(candidates, lastSent, now);
    const alert = composeAlert(due);
    if (!alert) return { sent: false, due: 0 };

    const result = await this.alerter.send(alert);
    if (result.sent) {
      // La mémoire ne s'écrit que si le message est PARTI : un canal en panne
      // réessaie au prochain passage au lieu de croire avoir sonné.
      await this.log.bulkWrite(
        due.map((c) => ({
          updateOne: { filter: { key: c.key }, update: { $set: { sentAt: now } }, upsert: true },
        })),
      );
    }
    return { sent: result.sent, due: due.length };
  }
}
