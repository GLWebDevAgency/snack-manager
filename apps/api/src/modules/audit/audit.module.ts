import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuditLog } from '@sm/db';

/**
 * Journal append-only des actions sensibles (annulation, remise,
 * remboursement, changement de prix) — socle de la traçabilité NF525.
 */
@Injectable()
export class AuditService {
  constructor(@InjectModel('AuditLog') private readonly logs: Model<AuditLog>) {}

  async log(entry: {
    tenantId: string;
    staffId?: string | null;
    action: string;
    targetId?: string;
    meta?: unknown;
    pinVerifiedAt?: Date;
  }) {
    await this.logs.create({ ...entry, at: new Date() });
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
