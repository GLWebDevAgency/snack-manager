import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, type ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Le navigateur parle au serveur Next ; seul ce serveur parle à l'ingestion
 * CRM. La route est `@Public()` vis-à-vis du JWT global, mais pas anonyme : ce
 * jeton de service empêche de transformer Mongo en formulaire de spam direct.
 */
@Injectable()
export class ContactIngestGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('SM_CONTACT_INGEST_TOKEN')?.trim();
    const request = context.switchToHttp().getRequest<Request>();
    if (!expected || !serviceBearerMatches(request.headers.authorization, expected)) {
      // Même réponse si la route n'est pas configurée ou si le jeton est faux.
      throw new NotFoundException();
    }
    return true;
  }
}

export function serviceBearerMatches(header: string | undefined, expected: string): boolean {
  const presented = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  const presentedDigest = createHash('sha256').update(presented).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}
