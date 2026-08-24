import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { LOGO_MAX_OCTETS } from '@sm/contracts';
import { Public, Roles, TenantId } from '../../common/auth';
import { LogoService } from './logo.service';

/**
 * Le fichier tel que multer le remet — réduit aux trois champs lus ici.
 * Pas de `@types/multer` pour trois propriétés : l'interface locale dit
 * exactement ce dont la route dépend, et rien de plus.
 */
interface FichierRecu {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller()
export class LogoController {
  constructor(private readonly logo: LogoService) {}

  /**
   * PUT et non POST : poser le logo est idempotent — le nouveau remplace
   * l'ancien, il n'y a jamais deux logos. La limite multer coupe court à un
   * envoi énorme (413 avant de remplir la mémoire) ; l'écran vérifie la même
   * borne AVANT d'envoyer, avec la phrase en français.
   */
  @Roles('owner', 'gerant')
  @Put('tenants/me/logo')
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: LOGO_MAX_OCTETS } }))
  async poser(
    @TenantId() tenantId: string,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Req() req: Request,
  ) {
    if (!this.logo.actif) {
      throw new ServiceUnavailableException(
        "L'hébergement d'images n'est pas encore activé sur cet environnement — appelez-nous, on l'allume.",
      );
    }
    if (!fichier?.buffer?.length) {
      throw new BadRequestException('Aucun fichier reçu — choisissez une image.');
    }
    // L'hôte public vient de la requête elle-même (`trust proxy` posé dans
    // main.ts) : l'URL suit le domaine réellement servi, sans variable à
    // maintenir par environnement.
    const origin = `${req.protocol}://${req.get('host')}`;
    return this.logo.poser(tenantId, origin, fichier.buffer);
  }

  @Roles('owner', 'gerant')
  @Delete('tenants/me/logo')
  retirer(@TenantId() tenantId: string) {
    return this.logo.retirer(tenantId);
  }

  /**
   * La route que `logoUrl` désigne — publique comme le menu : la page de
   * commande, le board TV et les tablettes la lisent sans jeton. `immutable`
   * est honnête : un nouvel envoi change `?v=`, jamais le contenu d'une URL.
   */
  @Public()
  @Get('public/tenants/:slug/logo')
  async servir(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const logo = await this.logo.servir(slug);
    if (!logo) throw new NotFoundException('Pas de logo pour cet établissement');
    res.setHeader('content-type', logo.type);
    res.setHeader('content-length', String(logo.corps.length));
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    return new StreamableFile(logo.corps);
  }
}
