import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  MEDIA_MAX_OCTETS,
  MediaDescribeSchema,
  ProduitMediasSchema,
  type JwtPayload,
  type MediaDescribe,
} from '@sm/contracts';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { zod } from '../../common/zod.pipe';
import { imageAutorisee, OriginesImages } from '../tenants/origines-images';
import { MediasService } from './medias.service';

/**
 * Le fichier tel que multer le remet — réduit aux champs lus ici. Même
 * interface locale que `logo.controller.ts` : trois propriétés ne justifient
 * pas `@types/multer`.
 */
interface FichierRecu {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller()
export class MediasController {
  constructor(
    private readonly medias: MediasService,
    private readonly origines: OriginesImages,
  ) {}

  // ─── La médiathèque du gérant ───

  /**
   * DÉPOSER UNE PHOTO.
   *
   * `POST` et non `PUT` — à la différence du logo, il n'y a pas UNE photo mais
   * une bibliothèque : chaque dépôt ajoute. L'idempotence n'est pas perdue
   * pour autant, elle est portée par le CONTENU : redéposer le même fichier
   * retrouve la même ligne (dédoublonnage par empreinte).
   *
   * La limite multer coupe court à un envoi énorme (413 avant de remplir la
   * mémoire) ; l'écran vérifie la même borne AVANT d'envoyer, en français.
   */
  @Roles('owner', 'gerant')
  @Post('medias')
  @UseInterceptors(
    FileInterceptor('fichier', { limits: { fileSize: MEDIA_MAX_OCTETS, files: 1, fields: 1 } }),
  )
  async deposer(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() fichier: FichierRecu | undefined,
    @Body('alt') alt: string | undefined,
    @Req() req: Request,
  ) {
    if (!this.medias.actif) {
      throw new ServiceUnavailableException(
        "L'hébergement d'images n'est pas encore activé sur cet environnement — appelez-nous, on l'allume.",
      );
    }
    if (!fichier?.buffer?.length) {
      throw new BadRequestException('Aucun fichier reçu — choisissez une photo.');
    }
    return this.medias.deposer(tenantId, this.origineDe(req), fichier.buffer, {
      alt: typeof alt === 'string' ? alt : undefined,
      actor: user,
    });
  }

  /** Sa bibliothèque : les médias, l'emploi de chacun, l'état du quota. */
  @Roles('owner', 'gerant')
  @Get('medias')
  lister(@TenantId() tenantId: string) {
    return this.medias.lister(tenantId);
  }

  /** Décrire : texte alternatif, point d'intérêt. Jamais les octets. */
  @Roles('owner', 'gerant')
  @Patch('medias/:id')
  decrire(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(MediaDescribeSchema)) body: MediaDescribe,
  ) {
    return this.medias.decrire(tenantId, id, body);
  }

  /**
   * Retirer. Refusé (409 + la liste des plats concernés) si des produits
   * l'emploient, sauf confirmation explicite `?force=true` — la mécanique de
   * `DELETE /categories/:id`, éprouvée et déjà comprise des écrans.
   */
  @Roles('owner', 'gerant')
  @Delete('medias/:id')
  retirer(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    return this.medias.retirer(tenantId, id, force === 'true');
  }

  /**
   * LES PHOTOS D'UN PLAT — la liste complète, dans l'ordre. Attacher, détacher
   * et réordonner sont le même geste (cf. `ProduitMediasSchema`).
   *
   * Elle vit dans ce contrôleur et pas dans celui du menu : c'est la
   * médiathèque qui sait ce qu'est un média valide, qui appartient à qui, et
   * quel genre a le droit de s'afficher sur une carte.
   */
  @Roles('owner', 'gerant')
  @Put('products/:id/medias')
  rattacher(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(ProduitMediasSchema)) body: { medias: string[] },
  ) {
    return this.medias.rattacher(tenantId, id, body.medias);
  }

  // ─── La route publique ───

  /**
   * LES OCTETS, SOUS LE RESTAURANT QUI LES POSSÈDE.
   *
   * Publique comme le menu : la vitrine, l'écran de salle et les tablettes la
   * lisent sans jeton. `immutable` est ici plus qu'une promesse — l'adresse
   * porte l'empreinte du contenu, donc des octets différents ont une adresse
   * différente, par construction.
   *
   * ─── ET UNE LIMITE DE DÉBIT, QUE LA ROUTE DU LOGO N'A PAS ───
   *
   * Le logo s'en passe : un objet par restaurant, mis en cache dès le premier
   * service, et l'API REST de Cloudflare n'est jamais retouchée. Une
   * médiathèque n'a aucune de ces propriétés — des centaines d'objets, un
   * cache mémoire BORNÉ qui laisse forcément passer des défauts, et donc une
   * lecture R2 à chaque empreinte encore inconnue. Sans plafond, une boucle
   * sur des empreintes au hasard transforme cette route publique en robinet à
   * requêtes R2 : notre quota d'API brûlé, et la vitrine du restaurant sans
   * photos pendant ce temps. 240 par minute et par IP laisse charger plusieurs
   * cartes complètes d'affilée sans jamais gêner un mangeur.
   *
   * Le tenant est désigné par son IDENTIFIANT et non par son slug — seule
   * différence de forme avec `/public/tenants/:slug/logo`, et elle est voulue :
   * un slug peut changer (geste d'équipe SM), et l'adresse d'un média ne doit
   * JAMAIS changer sans que ses octets changent, sinon la caisse hors ligne
   * retélécharge toute la carte le jour d'un renommage.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Get('public/medias/:tenantId/:empreinte')
  async servir(
    @Param('tenantId') tenantId: string,
    @Param('empreinte') empreinte: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const media = await this.medias.servir(tenantId, empreinte);
    if (!media) throw new NotFoundException('Photo introuvable');
    res.setHeader('content-type', media.type);
    res.setHeader('content-length', String(media.corps.length));
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    // Un polyglotte PNG/HTML servi image/* ne doit jamais être « deviné » HTML.
    res.setHeader('x-content-type-options', 'nosniff');
    return new StreamableFile(media.corps);
  }

  /**
   * L'HÔTE DE LA REQUÊTE EST UNE ENTRÉE, PAS UNE VÉRITÉ.
   *
   * Reprise mot pour mot de `logo.controller.ts`, parce que le défaut est
   * identique : cette route ne REÇOIT aucune URL, elle en FABRIQUE une à partir
   * de `X-Forwarded-Host` puis de `Host`, deux en-têtes que le client contrôle.
   * L'adresse obtenue part ensuite dans `photoUrl` sur la vitrine, le tableau
   * de menu, la caisse et les données structurées — un gérant qui poserait
   * `X-Forwarded-Host: mechant.fr` ferait servir les photos de sa carte par un
   * tiers, qui voit l'IP de tous ses clients et décide de ce qui s'affiche.
   *
   * C'est exactement le contournement que la chaîne libre `photoUrl` ouvrait,
   * et il serait absurde de le fermer d'un côté pour le rouvrir de l'autre. On
   * REFUSE plutôt que de corriger en silence : un hôte hors liste signale une
   * passerelle mal câblée, et lui substituer un domaine deviné servirait des
   * photos introuvables sans que personne ne comprenne pourquoi.
   */
  private origineDe(req: Request): string {
    const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0]?.trim();
    const origin = `${req.protocol}://${forwardedHost || req.get('host')}`;
    if (!imageAutorisee(origin, this.origines.hotes)) {
      throw new BadRequestException(
        `Cette requête arrive d'un hôte que nous ne servons pas (${origin}) — ` +
          'les photos auraient pointé ailleurs que chez nous.',
      );
    }
    return origin;
  }
}
