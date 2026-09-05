import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Roles, TenantId } from '../../common/auth';
import {
  PromotionCreateSchema,
  PromotionUpdateSchema,
  ReviewReplySchema,
  type PromotionCreate,
  type PromotionUpdate,
  type ReviewReply,
} from './engage.dto';
import { EngageService } from './engage.service';
import { Fonction } from '../../common/capacites';

@Controller()
@Fonction('promos')
export class EngageController {
  constructor(private readonly engage: EngageService) {}

  // ─── Promotions (gérant) ───

  // Les lectures ne portaient aucun rôle quand toutes les écritures en
  // portaient un : promotions et avis clients sont du back-office gérant.
  @Roles('owner', 'gerant')
  @Get('promotions')
  listPromotions(@TenantId() tenantId: string) {
    return this.engage.listPromotions(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('promotions')
  createPromotion(@TenantId() tenantId: string, @Body(zod(PromotionCreateSchema)) body: unknown) {
    return this.engage.createPromotion(tenantId, body as PromotionCreate);
  }

  @Roles('owner', 'gerant')
  @Patch('promotions/:id')
  updatePromotion(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(PromotionUpdateSchema)) body: unknown,
  ) {
    return this.engage.updatePromotion(tenantId, id, body as PromotionUpdate);
  }

  /** Bascule actif/inactif (toggle de la carte promo). */
  @Roles('owner', 'gerant')
  @Post('promotions/:id/toggle')
  togglePromotion(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.engage.togglePromotion(tenantId, id);
  }

  @Roles('owner', 'gerant')
  @Delete('promotions/:id')
  deletePromotion(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.engage.deletePromotion(tenantId, id);
  }

  // ─── Avis clients ───

  /** `?filter=pending` = avis sans réponse ; défaut : tous. */
  @Roles('owner', 'gerant')
  @Get('reviews')
  @Fonction('reviews')
  listReviews(@TenantId() tenantId: string, @Query('filter') filter?: string) {
    return this.engage.listReviews(tenantId, filter === 'pending' ? 'pending' : 'all');
  }

  @Roles('owner', 'gerant')
  @Get('reviews/summary')
  @Fonction('reviews')
  reviewsSummary(@TenantId() tenantId: string) {
    return this.engage.reviewsSummary(tenantId);
  }

  @Roles('owner', 'gerant')
  @Post('reviews/:id/reply')
  @Fonction('reviews')
  replyToReview(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(ReviewReplySchema)) body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.engage.replyToReview(tenantId, id, (body as ReviewReply).text, user.sub);
  }
}
