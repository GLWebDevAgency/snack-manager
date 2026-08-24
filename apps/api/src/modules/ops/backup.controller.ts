import { Controller, Get, Inject, Logger, NotFoundException, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import type { Request } from 'express';
import { Connection } from 'mongoose';
import { EJSON } from 'bson';
import type { Pool } from 'pg';
import { Public } from '../../common/auth';
import { SUPPLY_POOL } from '../../supply-db.module';
import { backupTokenMatches } from './backup-token';

/**
 * L'EXPORT DE SAUVEGARDE — parce que « ni GitHub ni Railway ne restaurent des
 * données » (docs/CI-CD.md § 12), et qu'un dump manuel n'existe que si
 * quelqu'un l'a lancé récemment.
 *
 * Un GET authentifié par `SM_BACKUP_TOKEN` rend TOUTE la base : chaque
 * collection Mongo en EJSON canonique (les ObjectId et les dates survivent au
 * voyage — un dump non restaurable n'est pas une sauvegarde), chaque table
 * PostgreSQL en lignes brutes. Le travail planifié `.github/workflows/
 * sauvegarde.yml` l'appelle chaque nuit et range le résultat en artefact.
 *
 * PostgreSQL en panne ne vide pas la sauvegarde : on emporte ce qui répond,
 * et `partial: true` dit honnêtement qu'il manque un morceau.
 */
@Public()
@Controller('ops')
export class BackupController {
  private readonly logger = new Logger('Sauvegarde');

  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(SUPPLY_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  @Get('export')
  async export(@Req() req: Request): Promise<Record<string, unknown>> {
    const expected = this.config.get<string>('SM_BACKUP_TOKEN')?.trim();
    // Absent OU faux : le même 404, pour ne pas confirmer que la route existe.
    if (!expected || !backupTokenMatches(req.headers.authorization, expected)) {
      throw new NotFoundException();
    }

    const db = this.mongo.db;
    if (!db) throw new NotFoundException();

    const mongo: Record<string, unknown> = {};
    const names = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();
    for (const name of names) {
      const docs = await db.collection(name).find({}).toArray();
      mongo[name] = EJSON.serialize(docs, { relaxed: false });
    }

    let postgres: Record<string, unknown> = {};
    let partial = false;
    try {
      const tables = await this.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      );
      for (const { table_name } of tables.rows) {
        const rows = await this.pool.query(`SELECT * FROM "${table_name.replaceAll('"', '""')}"`);
        postgres[table_name] = rows.rows;
      }
    } catch (cause) {
      partial = true;
      postgres = { __erreur: `PostgreSQL injoignable : ${String(cause).slice(0, 200)}` };
      this.logger.warn('Export partiel — PostgreSQL injoignable');
    }

    this.logger.log(`Export de sauvegarde servi (${names.length} collections)`);
    return {
      format: 'sm-sauvegarde-v1',
      at: new Date().toISOString(),
      revision: this.config.get<string>('SM_REVISION') ?? null,
      partial,
      mongo,
      postgres,
    };
  }
}
