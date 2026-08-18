import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/**
 * Statistiques — agrégations MongoDB server-side (CA, commandes, top produits,
 * canaux, heatmap d'affluence, temps de préparation) + exports CSV Excel FR.
 * Les modèles Mongoose viennent du DatabaseModule global.
 */
@Module({
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
