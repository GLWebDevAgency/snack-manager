import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * Équipe & pointage : CRUD membres (PIN argon2 unique par tenant),
 * badge arrivée/départ, heures hebdo arrondies 0,5 h par shift.
 * Modèles Staff/Shift fournis par le DatabaseModule global.
 */
@Module({
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
