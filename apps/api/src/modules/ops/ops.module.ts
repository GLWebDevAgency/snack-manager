import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CrmModule } from '../crm/crm.module';
import { AlertsService } from './alerts.service';
import { BackupController } from './backup.controller';
import { OpsController } from './ops.controller';
import { OpsExceptionFilter } from './ops-exception.filter';
import { OpsService } from './ops.service';
import { PublicErrorsController } from './public-errors.controller';

/**
 * Exploitation de la plateforme — le filet P0 du diagnostic quatre casquettes :
 * journal d'erreurs (filtre API + guichet public), veilleur d'alertes.
 *
 * `APP_FILTER` déclaré ICI s'applique GLOBALEMENT : c'est la mécanique Nest,
 * pas un oubli — le module qui possède le journal possède aussi le filet qui
 * l'alimente. `CrmModule` est importé pour `SignalsService` : le veilleur ne
 * recalcule rien, il pousse la même file que l'écran /sm/signals.
 *
 * ⚠️ Câblage : ajouter `OpsModule` aux `imports` de `AppModule` — l'oubli
 * d'enregistrement s'est déjà produit deux fois sur ce projet.
 */
@Module({
  imports: [CrmModule],
  controllers: [OpsController, PublicErrorsController, BackupController],
  providers: [
    OpsService,
    AlertsService,
    { provide: APP_FILTER, useClass: OpsExceptionFilter },
  ],
  exports: [OpsService],
})
export class OpsModule {}
