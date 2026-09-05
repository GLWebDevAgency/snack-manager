import { BadRequestException, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Param, Post, Req, ServiceUnavailableException, UseGuards, type CanActivate, type ExecutionContext, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public, TenantId, type AuthedRequest } from '../../common/auth';
import { TenantSessionGuard } from './tenant-session.guard';
import { InvoiceCheckoutGateway } from './invoice-checkout.gateway';
import { InvoiceCheckoutService } from './invoice-checkout.service';

/** Suspension commerciale ignorée pour régulariser, jamais les rôles ou révocations. */
@Injectable()
export class InvoiceOwnerGuard implements CanActivate {
  constructor(private readonly session: TenantSessionGuard) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.session.canActivate(context);
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (user?.role !== 'owner' || user.kind !== 'user') throw new ForbiddenException('Paiement réservé au propriétaire.');
    return true;
  }
}

@Public()
@UseGuards(InvoiceOwnerGuard)
@Controller('billing/me')
export class InvoiceCheckoutController {
  constructor(private readonly payments: InvoiceCheckoutService) {}
  @Get('checkout-availability')
  availability() { return this.payments.available(); }
  @Post('invoices/:id/checkout')
  checkout(@TenantId() tenantId: string, @Param('id') invoiceId: string) {
    return this.payments.checkout(tenantId, invoiceId);
  }
}

@Controller('public/stripe/billing')
export class InvoiceCheckoutWebhookController {
  constructor(private readonly gateway: InvoiceCheckoutGateway, private readonly payments: InvoiceCheckoutService) {}
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() request: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    let event;
    try { event = this.gateway.constructEvent(request.rawBody, signature); }
    catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException('Signature Stripe invalide.');
    }
    return this.payments.webhook(event);
  }
}
