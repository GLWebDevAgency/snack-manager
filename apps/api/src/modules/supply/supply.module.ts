import { Module } from '@nestjs/common';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';

/**
 * Contexte SUPPLY : ingrédients, recettes/nomenclatures (BOM), fournisseurs,
 * coût matière & marges, alertes et cascade de rupture ingrédient → produits.
 * Dépendances (SupplyDb Postgres, modèles Mongo, Redis) fournies par les
 * modules globaux SupplyDbModule, DatabaseModule et RedisModule.
 */
@Module({
  controllers: [SupplyController],
  providers: [SupplyService],
  // Exporté pour le module menu : les modificateurs de la caisse (« sans
  // tomate », suppléments payants) sont dérivés des recettes, pas ressaisis.
  exports: [SupplyService],
})
export class SupplyModule {}
