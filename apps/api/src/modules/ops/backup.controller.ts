import { Readable } from 'node:stream';
import {
  ConflictException,
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  NotFoundException,
  Req,
  StreamableFile,
} from '@nestjs/common';
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
 * sauvegarde.yml` l'appelle chaque nuit et range le résultat sur R2.
 *
 * ═══ EN FLUX, DOCUMENT PAR DOCUMENT — C'ÉTAIT LE PREMIER MUR ═══
 *
 * La première version matérialisait la base entière en mémoire (toArray puis
 * un seul JSON.stringify) : sur un conteneur de 512 Mo, l'API serait morte en
 * OOM vers ~15 client-mois d'historique cumulé — et quel que soit le plan,
 * V8 refuse une chaîne au-delà de ~512 Mo (« Invalid string length »), soit
 * ~115 client-mois. La sauvegarde aurait été la PREMIÈRE panne franche de la
 * croissance, en silence, à 03:17 du matin.
 *
 * Désormais le JSON s'écrit en FLUX : un curseur par collection, un document
 * sérialisé à la fois, jamais plus de quelques documents en mémoire. Le
 * FORMAT ne change pas d'un octet (`sm-sauvegarde-v1`, mêmes clés) : les
 * workflows de sauvegarde et l'exercice de restauration relisent l'export
 * sans rien savoir du changement. Seule concession au flux : `partial` — qui
 * ne se connaît qu'après avoir tenté PostgreSQL — se lit en FIN d'objet.
 *
 * PostgreSQL en panne ne vide pas la sauvegarde : on emporte ce qui répond,
 * et `partial: true` dit honnêtement qu'il manque un morceau.
 */
@Public()
@Controller('ops')
export class BackupController {
  private readonly logger = new Logger('Sauvegarde');

  /**
   * UN export à la fois : deux appels concurrents doubleraient la pression
   * sur la base et diviseraient d'autant les marges mémoire — et une nuit
   * n'a besoin que d'une sauvegarde. Le second appel reçoit un 409 net.
   */
  private exportEnCours = false;

  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(SUPPLY_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  @Get('export')
  @Header('content-type', 'application/json; charset=utf-8')
  export(@Req() req: Request): StreamableFile {
    const expected = this.config.get<string>('SM_BACKUP_TOKEN')?.trim();
    // Absent OU faux : le même 404, pour ne pas confirmer que la route existe.
    if (!expected || !backupTokenMatches(req.headers.authorization, expected)) {
      throw new NotFoundException();
    }
    if (this.exportEnCours) {
      throw new ConflictException('Un export de sauvegarde est déjà en cours — réessayez après.');
    }
    this.exportEnCours = true;
    // Le générateur porte le verrou : la méthode rend le flux immédiatement,
    // seule la FIN du flux (ou sa mort) doit le relâcher.
    return new StreamableFile(Readable.from(this.flux()));
  }

  private async *flux(): AsyncGenerator<string> {
    try {
      const db = this.mongo.db;
      if (!db) throw new NotFoundException();

      yield `{"format":"sm-sauvegarde-v1","at":${JSON.stringify(new Date().toISOString())},` +
        `"revision":${JSON.stringify(this.config.get<string>('SM_REVISION') ?? null)},"mongo":{`;

      const names = (await db.listCollections().toArray())
        .map((c) => c.name)
        .filter((name) => !name.startsWith('system.'))
        .sort();
      let premiereCollection = true;
      for (const name of names) {
        yield `${premiereCollection ? '' : ','}${JSON.stringify(name)}:[`;
        premiereCollection = false;
        let premierDocument = true;
        // Le curseur tient UN document à la fois — c'est toute la correction.
        for await (const doc of db.collection(name).find({})) {
          yield (premierDocument ? '' : ',') + EJSON.stringify(doc, { relaxed: false });
          premierDocument = false;
        }
        yield ']';
      }

      yield '},"postgres":{';
      let partial = false;
      // Déclarée HORS du try : la panne peut frapper après une table déjà
      // écrite, et la virgule de l'entrée d'erreur en dépend.
      let premiereTable = true;
      try {
        const tables = await this.pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
        );
        for (const { table_name } of tables.rows) {
          const rows = await this.pool.query(
            `SELECT * FROM "${table_name.replaceAll('"', '""')}"`,
          );
          yield `${premiereTable ? '' : ','}${JSON.stringify(table_name)}:${JSON.stringify(rows.rows)}`;
          premiereTable = false;
        }
        yield `}`;
      } catch (cause) {
        // Le JSON doit rester VALIDE même en panne à mi-chemin : on referme
        // proprement avec l'erreur en dernière entrée, et `partial` le dira.
        partial = true;
        const erreur = `PostgreSQL injoignable : ${String(cause).slice(0, 200)}`;
        yield `${premiereTable ? '' : ','}"__erreur":${JSON.stringify(erreur)}}`;
        this.logger.warn('Export partiel — PostgreSQL injoignable');
      }
      yield `,"partial":${partial}}`;

      this.logger.log(`Export de sauvegarde servi en flux (${names.length} collections)`);
    } finally {
      this.exportEnCours = false;
    }
  }
}
