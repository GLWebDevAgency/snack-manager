import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderNotificationsController } from './order-notifications.controller';
import { OrderNotificationsService } from './order-notifications.service';
import { OrderNotificationsWorker } from './order-notifications.worker';
import { OrderPushSender } from './order-push.sender';
import { ORDER_PUSH_CONFIG, orderPushConfig } from './order-push.crypto';

@Module({
  controllers: [OrderNotificationsController],
  providers: [OrderNotificationsService, OrderNotificationsWorker, OrderPushSender, {
    provide: ORDER_PUSH_CONFIG, inject: [ConfigService], useFactory: (config: ConfigService) => orderPushConfig({
      ORDER_PUSH_VAPID_PUBLIC_KEY: config.get<string>('ORDER_PUSH_VAPID_PUBLIC_KEY'),
      ORDER_PUSH_VAPID_PRIVATE_KEY: config.get<string>('ORDER_PUSH_VAPID_PRIVATE_KEY'),
      ORDER_PUSH_VAPID_SUBJECT: config.get<string>('ORDER_PUSH_VAPID_SUBJECT'),
      ORDER_PUSH_ENCRYPTION_KEY_BASE64: config.get<string>('ORDER_PUSH_ENCRYPTION_KEY_BASE64'),
    }),
  }],
})
export class OrderNotificationsModule {}
