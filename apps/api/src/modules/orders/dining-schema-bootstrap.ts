import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { DiningTableRecord, DiningSessionRecord, DiningOrderPricingRecord } from '@sm/db';

/** Additive DDL for the three new dining collections only. Never syncIndexes:
 * this must not drop an index, rewrite historical orders or mutate a tenant. */
export async function prepareDiningSchemas(tables: Model<DiningTableRecord>, sessions: Model<DiningSessionRecord>, pricing: Model<DiningOrderPricingRecord>): Promise<void> {
  await Promise.all([tables.createCollection(), sessions.createCollection(), pricing.createCollection()]);
  await Promise.all([tables.createIndexes(), sessions.createIndexes(), pricing.createIndexes()]);
}

@Injectable()
export class DiningSchemaBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiningSchemaBootstrap.name);
  constructor(
    @InjectModel('DiningTable') private readonly tables: Model<DiningTableRecord>,
    @InjectModel('DiningSession') private readonly sessions: Model<DiningSessionRecord>,
    @InjectModel('DiningOrderPricing') private readonly pricing: Model<DiningOrderPricingRecord>,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    try {
      await prepareDiningSchemas(this.tables, this.sessions, this.pricing);
      this.logger.log('Schémas et index du service à table préparés.');
    } catch {
      // Existing ordering/payment services remain available. Every dining
      // assignment verifies required indexes and fails closed until repaired.
      this.logger.error('Service à table indisponible : préparation des index refusée. Vérifier les droits DDL Mongo puis redémarrer l’API.');
    }
  }
}
