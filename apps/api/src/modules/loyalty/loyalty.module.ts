import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyMemberController } from './loyalty-member.controller';
import { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyOrderEarnProcessor } from './loyalty-order-earn.processor';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyPublicController } from './loyalty-public.controller';
import { LoyaltyPublicService } from './loyalty-public.service';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

@Module({
  imports: [TenantsModule],
  controllers: [LoyaltyController, LoyaltyMemberController, LoyaltyPublicController],
  providers: [
    LoyaltyAdminService,
    LoyaltyMemberService,
    LoyaltyOrderEarnProcessor,
    LoyaltyPublicService,
    LoyaltyPurchaseVerifier,
  ],
})
export class LoyaltyModule {}
