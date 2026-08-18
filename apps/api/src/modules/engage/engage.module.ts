import { Module } from '@nestjs/common';
import { EngageController } from './engage.controller';
import { EngageService } from './engage.service';

/** Engagement client : codes promo + avis & réponses (spec backoffice §8 et §11). */
@Module({
  controllers: [EngageController],
  providers: [EngageService],
})
export class EngageModule {}
