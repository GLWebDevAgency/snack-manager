import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Tenant } from '@sm/db';
import type { Model } from 'mongoose';
import { LoyaltyMemberService } from './loyalty-member.service';

const SWEEP_INTERVAL_MS = 5 * 60_000;
const FIRST_RUN_DELAY_MS = 15_000;
const MAX_ENROLLMENTS_PER_TENANT = 100;

export interface LoyaltyEnrollmentExpiryDrainResult {
  tenants: number;
  expired: number;
  failedTenants: number;
}

/**
 * Purge périodiquement la PII des adhésions dont le QR initial n'a jamais été
 * remis. Chaque tenant reste traité sous son propre contexte RLS PostgreSQL ;
 * le worker n'obtient jamais un accès transversal aux profils fidélité.
 */
@Injectable()
export class LoyaltyEnrollmentExpiryProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LoyaltyEnrollmentExpiryProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRunTimer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly loyalty: LoyaltyMemberService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const run = () => {
      void this.drain().catch(() => {
        this.logger.warn("Balayage des adhésions expirées différé : dépendance indisponible");
      });
    };
    this.timer = setInterval(run, SWEEP_INTERVAL_MS);
    this.timer.unref();
    this.firstRunTimer = setTimeout(run, FIRST_RUN_DELAY_MS);
    this.firstRunTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRunTimer) clearTimeout(this.firstRunTimer);
    this.timer = null;
    this.firstRunTimer = null;
  }

  async drain(now = new Date()): Promise<LoyaltyEnrollmentExpiryDrainResult> {
    if (this.draining) return { tenants: 0, expired: 0, failedTenants: 0 };
    this.draining = true;
    try {
      const tenantRows = (await this.tenants
        .find({}, { _id: 1 })
        .lean()) as unknown as Array<{ _id: unknown }>;
      const result: LoyaltyEnrollmentExpiryDrainResult = {
        tenants: tenantRows.length,
        expired: 0,
        failedTenants: 0,
      };
      for (const tenant of tenantRows) {
        try {
          result.expired += await this.loyalty.expireStaleEnrollments(
            String(tenant._id),
            now,
            MAX_ENROLLMENTS_PER_TENANT,
          );
        } catch {
          result.failedTenants += 1;
          this.logger.warn("Balayage d'un restaurant différé : données indisponibles");
        }
      }
      return result;
    } finally {
      this.draining = false;
    }
  }
}
