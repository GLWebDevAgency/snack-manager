import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  LoyaltyCustomerCardResolveSchema,
  type LoyaltyCustomerCardResolve,
} from '@sm/contracts';
import { Public } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { LoyaltyPublicService } from './loyalty-public.service';

@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public/tenants/:slug/loyalty')
export class LoyaltyPublicController {
  constructor(private readonly loyalty: LoyaltyPublicService) {}

  @Get()
  catalog(@Param('slug') slug: string) {
    return this.loyalty.catalog(slug);
  }

  @Post('card')
  @HttpCode(200)
  card(
    @Param('slug') slug: string,
    @Body(zod(LoyaltyCustomerCardResolveSchema)) body: LoyaltyCustomerCardResolve,
  ) {
    return this.loyalty.card(slug, body.qrToken);
  }
}
