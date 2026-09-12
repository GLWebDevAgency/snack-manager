import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { PostgresCustomerIdentityRepository } from '@sm/customer';
import { POSTGRES_POOL } from '../../postgres.module';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountGuard } from './customer-account.guard';
import { CustomerAccountHumanVerifier, CUSTOMER_HUMAN_FETCH } from './customer-account.human';
import { CustomerAccountRuntime, CUSTOMER_IDENTITY_REPOSITORY, CUSTOMER_VERIFICATION_TRANSPORT_FACTORY,
  type CustomerVerificationTransportFactory } from './customer-account.runtime';
import { TwilioVerifyTransport } from './twilio-verify.transport';
import { TwilioProductionObserver } from './twilio-production-observer';
import { OrdersModule } from '../orders/orders.module';
import { CustomerLoyaltyService } from './customer-loyalty.service';
import { CustomerSaleAttributionService } from './customer-sale-attribution.service';

@Module({
  imports: [OrdersModule],
  controllers: [CustomerAccountController],
  providers: [CustomerAccountGuard, CustomerAccountRuntime, CustomerAccountHumanVerifier, CustomerLoyaltyService, CustomerSaleAttributionService,
    { provide: TwilioProductionObserver, useFactory: () => new TwilioProductionObserver() },
    { provide: CUSTOMER_HUMAN_FETCH, useValue: globalThis.fetch },
    { provide: CUSTOMER_IDENTITY_REPOSITORY, inject: [POSTGRES_POOL],
      useFactory: (pool: Pool) => new PostgresCustomerIdentityRepository(pool) },
    { provide: CUSTOMER_VERIFICATION_TRANSPORT_FACTORY,
      useValue: ((config) => new TwilioVerifyTransport(config)) satisfies CustomerVerificationTransportFactory },
  ],
})
export class CustomerAccountModule {}
