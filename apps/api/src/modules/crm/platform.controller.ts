import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  PlatformSettingsUpdateSchema,
  type JwtPayload,
  type PlatformSettingsUpdate,
} from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Public, Roles } from '../../common/auth';
import { PlatformService } from './platform.service';

/**
 * RÉGLAGES DE PLATEFORME — ceux de Snack Manager, pas ceux d'un restaurant.
 *
 * `@Roles('sm_admin')` posé sur la CLASSE, exactement comme sur
 * `CrmController` et `AdminController` : toutes les routes en héritent, y
 * compris celles qu'on ajoutera demain. C'est le MÊME mécanisme que le reste
 * du CRM, délibérément — une seconde garde maison, écrite pour l'occasion,
 * serait une deuxième chose à maintenir et à ne pas oublier de poser.
 *
 * Un gérant de restaurant (`owner`) qui appelle ces routes avec son jeton
 * valide reçoit un 403 : ces liens partent sur NOTRE page d'accueil, ils ne
 * relèvent d'aucun de nos clients. La garde du web (`/sm`, qui renvoie un
 * gérant chez lui) n'est qu'un confort de navigation ; celle-ci est la seule
 * qui compte, et `platform.test.ts` la vérifie sur les décorateurs réels.
 *
 * À ne PAS ranger sous `/admin`, qui est le back-office du restaurateur : s'y
 * tromper donnerait à chaque client la main sur la vitrine de l'entreprise.
 */
@Roles('sm_admin')
@Controller('crm')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  /** Les réglages, rubrique par rubrique, avec la date de dernière modification. */
  @Get('platform/settings')
  settings() {
    return this.platform.platformSettings();
  }

  /**
   * Modifie une rubrique. Le corps est `{ social: { … } }` : une clé absente
   * laisse le réseau intact, une clé à `null` (ou vide) efface le lien.
   *
   * La validation vit dans `PlatformSettingsUpdateSchema` (@sm/contracts) et
   * la pipe rend ses messages FRANÇAIS tels quels, avec le chemin du champ
   * fautif (`social.instagram`). L'écran s'en sert pour poser l'erreur à côté
   * du champ concerné plutôt qu'en haut de page — sur quatre champs, un
   * message global oblige à chercher lequel est en cause.
   */
  @Patch('platform/settings')
  update(
    @CurrentUser() actor: JwtPayload,
    @Body(zod(PlatformSettingsUpdateSchema)) body: PlatformSettingsUpdate,
  ) {
    return this.platform.updateSettings(actor, body);
  }
}

/**
 * ═══ LA LECTURE PUBLIQUE — ET POURQUOI ELLE A SON PROPRE CONTRÔLEUR ═══
 *
 * La vitrine est une page d'accueil : aucune session, aucun jeton à présenter.
 * Elle doit pourtant savoir quels pictogrammes afficher. D'où cette route
 * ouverte.
 *
 * Elle est SÉPARÉE du contrôleur ci-dessus, et non ajoutée dedans avec un
 * `@Public()` sur la méthode. Techniquement les deux marchent — le guard
 * regarde `IS_PUBLIC` avant le rôle. Mais une classe où cohabitent des routes
 * protégées et des routes ouvertes est une classe où l'oubli d'un décorateur
 * ne se voit pas : la garde de la classe ne s'applique qu'à ce qui n'a pas été
 * déclaré public, et rien ne signale l'inverse. Deux classes, deux régimes :
 * ce qui est ici est public, et cela se lit sans compter les décorateurs.
 *
 * `@Public()` n'ouvre d'ailleurs rien de plus que ce que la méthode rend :
 * `publicSocial()` ne renvoie que les quatre liens, sans date de modification
 * ni auteur du changement.
 */
@Public()
@Controller()
export class PublicPlatformController {
  constructor(private readonly platform: PlatformService) {}

  /**
   * Les quatre liens de la vitrine.
   *
   * Toujours les quatre clés, `null` valant « pas de compte » : c'est ce qui
   * permet à la page d'accueil de n'afficher que les réseaux réellement
   * renseignés sans avoir à deviner si la réponse est complète.
   */
  @Get('public/platform/social')
  social() {
    return this.platform.publicSocial();
  }
}
