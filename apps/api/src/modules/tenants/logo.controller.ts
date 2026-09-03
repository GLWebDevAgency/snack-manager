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
import { LOGO_MAX_OCTETS, type JwtPayload } from '@sm/contracts';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { LogoService } from './logo.service';
import { imageAutorisee, OriginesImages } from './origines-images';

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
  constructor(
    private readonly logo: LogoService,
    private readonly origines: OriginesImages,
  ) {}

  /**
   * PUT et non POST : poser le logo est idempotent — le nouveau remplace
   * l'ancien, il n'y a jamais deux logos. La limite multer coupe court à un
   * envoi énorme (413 avant de remplir la mémoire) ; l'écran vérifie la même
   * borne AVANT d'envoyer, avec la phrase en français.
   */
  @Roles('owner', 'gerant')
  @Put('tenants/me/logo')
  // `files: 1, fields: 0` : la route ne lit qu'un fichier — multer n'a pas à
  // bufferiser des champs qu'aucun code ne consommera.
  @UseInterceptors(
    FileInterceptor('fichier', { limits: { fileSize: LOGO_MAX_OCTETS, files: 1, fields: 0 } }),
  )
  async poser(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
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
    /*
     * L'HÔTE DE LA REQUÊTE EST UNE ENTRÉE, PAS UNE VÉRITÉ.
     *
     * L'URL suit le domaine réellement servi, sans variable à maintenir par
     * environnement : `trust proxy` ne résout que le protocole, l'hôte se lit
     * d'abord dans X-Forwarded-Host (si le proxy le pose), sinon dans Host —
     * que Railway préserve. Mais ces deux en-têtes viennent du CLIENT. Un
     * gérant qui envoyait `X-Forwarded-Host: mechant.fr` faisait écrire
     * `https://mechant.fr/public/tenants/<slug>/logo?v=…` dans `logoUrl` ET
     * dans `brand.logo.mark.dark` : l'image de sa vitrine, de sa carte de
     * fidélité et de son tableau de menu était dès lors servie par un tiers,
     * qui voyait l'IP de tous ses clients et décidait de ce qui s'affiche.
     *
     * C'était le contournement exact de la liste blanche que les deux routes
     * `PATCH …/marque` appliquent (`origines-images.ts`) : là où une URL est
     * REÇUE elle est vérifiée, ici elle était FABRIQUÉE et ne l'était pas. On
     * la juge donc à la même aune. Refuser plutôt que corriger en silence :
     * un hôte hors liste sur cette route signale une passerelle mal câblée,
     * et lui substituer un domaine deviné servirait des logos introuvables
     * sans que personne ne comprenne pourquoi.
     */
    const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
    const origin = `${req.protocol}://${forwardedHost || req.get('host')}`;
    if (!imageAutorisee(origin, this.origines.hotes)) {
      throw new BadRequestException(
        `Cette requête arrive d'un hôte que nous ne servons pas (${origin}) — ` +
          'le logo aurait pointé ailleurs que chez nous.',
      );
    }
    return this.logo.poser(tenantId, origin, fichier.buffer, Date.now, user);
  }

  @Roles('owner', 'gerant')
  @Delete('tenants/me/logo')
  retirer(@TenantId() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.logo.retirer(tenantId, user);
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
    // Un polyglotte PNG/HTML servi image/* ne doit jamais être « deviné » HTML.
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(logo.corps);
  }
}
