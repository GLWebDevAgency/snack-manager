import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { LoginSchema, type Login } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { Public } from '../../common/auth';
import { AuthService } from './auth.service';

/**
 * 10 essais par minute et par adresse : un humain qui se trompe ne les
 * atteint jamais, un dictionnaire si. C'était l'un des trous du diagnostic
 * quatre casquettes (P3) — aucune limite nulle part, connexion comprise.
 */
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Post('login')
  login(@Body(zod(LoginSchema)) body: Login) {
    return this.auth.login(body);
  }

  /*
   * `POST /auth/pin` A ÉTÉ SUPPRIMÉE le 28/08/2026.
   *
   * Elle prenait l'établissement dans le CORPS (`{ tenantSlug, pin }`). Or un
   * slug n'est pas un secret : il figure dans toutes les URL publiques du
   * restaurant. N'importe qui pouvait donc énumérer des codes à quatre chiffres
   * contre l'équipe d'un établissement qu'il n'avait jamais approché, et
   * obtenir au premier succès une session équipe pleinement portée — lecture de
   * toutes les commandes avec le nom et le téléphone des clients, avancement
   * des statuts, prise de commande, remise selon le rôle du code trouvé.
   *
   * Le module `devices` avait été construit PRÉCISÉMENT pour fermer ce chemin :
   * l'établissement s'y déduit du jeton d'appareil et de lui seul, une tablette
   * ne pouvant nommer aucun autre restaurant. L'ancienne route avait été
   * laissée « le temps de la transition, rien de ce qui tourne ne casse » — et
   * plus rien ne tournait dessus : POS et KDS n'appellent que
   * `POST /public/devices/pin` depuis leur mise à jour.
   *
   * Une porte de transition qu'on oublie de refermer est une porte ouverte.
   */
}
