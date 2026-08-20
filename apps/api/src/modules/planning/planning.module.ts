import { Module } from '@nestjs/common';
import { StatsService } from '../stats/stats.service';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

/**
 * Planning des services : pose, brouillon/publication, duplication de semaine,
 * projection de masse salariale, confrontation prévu/pointé, et croisement
 * avec les prévisions de volume.
 *
 * `StatsService` est déclaré ici comme fournisseur plutôt qu'importé depuis
 * `StatsModule` : ce dernier ne l'exporte pas, et le planning n'a pas à
 * modifier un module qui ne lui appartient pas pour s'y brancher. Le service
 * est sans état — il ne fait que des agrégations Mongo à partir de modèles
 * fournis par le `DatabaseModule` global — donc une seconde instance dans cet
 * injecteur ne coûte rien et ne duplique aucune donnée. L'important est
 * ailleurs : la prévision de volume reste calculée par le MÊME code que le
 * tableau de bord, jamais par une copie qui divergerait.
 */
@Module({
  controllers: [PlanningController],
  providers: [PlanningService, StatsService],
})
export class PlanningModule {}
