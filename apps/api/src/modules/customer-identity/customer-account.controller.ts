import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CustomerAccountEnvelopes, CustomerLoyaltyResponseSchema, customerLoyaltyResponseForView } from '@sm/contracts';
import { Public } from '../../common/auth';
import { CustomerAccountGuard, type CustomerAccountRequest } from './customer-account.guard';
import { CustomerAccountRuntime } from './customer-account.runtime';
import { customerHttpError } from './customer-account.error';

@Public()
@Controller('public/customer')
@UseGuards(CustomerAccountGuard)
export class CustomerAccountController {
  constructor(@Inject(CustomerAccountRuntime) private readonly runtime: CustomerAccountRuntime) {}
  @Post(':slug/:action')
  async action(@Req() request: CustomerAccountRequest, @Res() response: Response): Promise<void> {
    if (!request.customerRelay) throw customerHttpError('relay');
    const result = await this.runtime.execute(request.customerRelay, request.body, request.customerDeadline);
    if (request.customerRelay.action === 'logout') { response.status(204).end(); return; }
    response.status(200).json(request.customerRelay.action === 'loyalty'
      ? customerLoyaltyResponseForView(CustomerLoyaltyResponseSchema.parse(result), CustomerAccountEnvelopes.loyalty.parse(request.body).orderRewards === 1)
      : result);
  }
}
