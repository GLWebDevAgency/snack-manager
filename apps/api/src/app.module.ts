import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { join } from 'node:path';

import { DatabaseModule } from './database.module';
import { RedisModule } from './redis.module';
import { HealthController } from './modules/health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Dev local : .env à la racine du monorepo ; en prod Railway les
      // variables sont injectées directement dans l'environnement.
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URL'),
      }),
    }),
    DatabaseModule,
    RedisModule,
    AuditModule,
    AuthModule,
    TenantsModule,
    MenuModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
