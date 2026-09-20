import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { SiteLeadCreateSchema, type SiteLeadAccepted, type SiteLeadCreate } from '@sm/contracts';
import { Public } from '../../common/auth';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { zod } from '../../common/zod.pipe';
import { ContactIngestGuard } from './contact-ingest.guard';
import { ContactIntakeService } from './contact-intake.service';

/**
 * Guichet d'acquisition séparé du CRM trans-tenant : aucune lecture, aucun
 * choix d'étape, aucune autorité `sm_admin`. Il ne sait faire qu'une chose :
 * ajouter un lead validé à la première colonne du pipeline.
 */
@Public()
@UseGuards(ContactIngestGuard)
@Controller('public/leads')
export class PublicLeadsController {
  constructor(
    private readonly intake: ContactIntakeService,
    private readonly quota: SharedPublicQuota,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body(zod(SiteLeadCreateSchema)) body: SiteLeadCreate): Promise<SiteLeadAccepted> {
    let allowed: boolean;
    try {
      allowed = await this.quota.reserve({
        scope: 'contact-leads',
        // Un seul appelant autorisé : le serveur de la vitrine. L'adresse du
        // visiteur n'est pas une frontière fiable dans Next et ne sort pas du
        // serveur web. La borne globale Redis est donc la borne de sécurité.
        clientKey: 'site-vitrine',
        windowMs: 10 * 60_000,
        clientLimit: 30,
        globalLimit: 30,
      });
    } catch {
      throw new ServiceUnavailableException(
        "L'enregistrement des demandes est momentanément indisponible.",
      );
    }
    if (!allowed) {
      throw new HttpException(
        'Trop de demandes ont été reçues. Réessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.intake.create(body);
  }
}
