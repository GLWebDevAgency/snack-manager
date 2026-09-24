import { Module } from '@nestjs/common';
import { OrderRewardService } from './order-reward.service';
@Module({ providers: [OrderRewardService], exports: [OrderRewardService] })
export class OrderRewardsModule {}
