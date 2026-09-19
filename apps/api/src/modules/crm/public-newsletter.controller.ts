import { Body, Controller, Header, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { ContactIngestGuard } from './contact-ingest.guard';
import { NewsletterService, NewsletterSubscribeSchema, type NewsletterAccepted, type NewsletterSubscribe } from './newsletter.service';

/** Newsletter consent is separate from a contact request or a CRM prospect. */
@Public()
@UseGuards(ContactIngestGuard)
@Controller('public/newsletter')
export class PublicNewsletterController {
  constructor(@Inject(NewsletterService) private readonly newsletter: NewsletterService) {}

  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  subscribe(@Body(zod(NewsletterSubscribeSchema)) body: NewsletterSubscribe): Promise<NewsletterAccepted> {
    return this.newsletter.subscribe(body);
  }
}
