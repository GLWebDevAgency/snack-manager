import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyEnrollmentExpiryProcessor } from './loyalty-enrollment-expiry.processor';
import { LoyaltyMemberController } from './loyalty-member.controller';
import { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyOrderEarnProcessor } from './loyalty-order-earn.processor';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyPublicController } from './loyalty-public.controller';
import { LoyaltyPublicService } from './loyalty-public.service';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { LoyaltyWebSettlementProcessor } from './loyalty-web-settlement.processor';
import { EncaissementModule } from '../encaissement/encaissement.module';
import { LoyaltySaleSettlementController } from './loyalty-sale-settlement.controller';
import { LoyaltySaleSettlementService } from './loyalty-sale-settlement.service';

@Module({
  imports: [TenantsModule, EncaissementModule],
  controllers: [LoyaltyController, LoyaltyMemberController, LoyaltyPublicController, LoyaltySaleSettlementController],
  providers: [
    LoyaltyAdminService,
    LoyaltyEnrollmentExpiryProcessor,
    LoyaltyMemberService,
    LoyaltyOrderEarnProcessor,
    LoyaltyPublicService,
    LoyaltyPurchaseVerifier,
    LoyaltyHistoricalSaleService,
    LoyaltyWebSettlementProcessor,
    LoyaltySaleSettlementService,
  ],
})
export class LoyaltyModule {}
