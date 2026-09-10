import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Tenant } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { paymentDomainsConfig } from './payment-domain-hosts';
import { MongoPaymentDomainsRepository } from './payment-domains.repository';
import { StripePaymentDomainsHttpClient } from './stripe-payment-domains.client';
import { PaymentDomainsWorker } from './payment-domains.worker';

@Module({
  providers: [{
    provide: PaymentDomainsWorker,
    inject: [ConfigService, getModelToken('Tenant'), REDIS_PUB],
    useFactory: (env: ConfigService, tenants: Model<Tenant>, redis: Redis) => {
      const secretKey = env.get<string>('STRIPE_SECRET_KEY');
      const config = paymentDomainsConfig({ secretKey, webUrl: env.get<string>('WEB_PUBLIC_URL'), rootDomain: env.get<string>('PUBLIC_ROOT_DOMAIN') });
      return new PaymentDomainsWorker(config, new MongoPaymentDomainsRepository(tenants), redis,
        config && secretKey ? new StripePaymentDomainsHttpClient(secretKey.trim(), config.mode) : null);
    },
  }],
})
export class PaymentDomainsModule {}
