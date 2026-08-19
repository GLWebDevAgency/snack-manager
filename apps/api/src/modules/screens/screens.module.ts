import { Module } from '@nestjs/common';
import { systemClock } from '@sm/domain';
import { CLOCK } from './screens.tokens';
import { ScreensController } from './screens.controller';
import { MenuBoardRepository } from './menu-board.repository';
import { ScreensRepository } from './screens.repository';
import { BuildScreenContent } from './build-screen-content.usecase';
import { HeartbeatScreen } from './heartbeat-screen.usecase';
import { ManageScreens } from './manage-screens.usecase';
import { PairScreenDevice } from './pair-screen.usecase';

/**
 * « Menu Board » — les écrans TV accrochés en salle.
 *
 * Le module ne crée AUCUNE donnée nouvelle : catégories, produits, photos,
 * prix, ruptures, promotions et horaires existent déjà. C'est une vue de plus
 * sur la même base, ce qui explique qu'un restaurateur passe de l'affiche
 * imprimée à 300 € — refaite à chaque changement de prix — à un écran juste en
 * permanence sans ressaisir une ligne.
 *
 * Deux dépôts, deux responsabilités : `ScreensRepository` détient les écrans et
 * leurs secrets, `MenuBoardRepository` n'est qu'un modèle de LECTURE de la
 * carte. Les cas d'usage ne connaissent ni Mongoose ni `Date.now()`.
 *
 * Les modèles Mongoose viennent de `DatabaseModule` (@Global).
 */
@Module({
  controllers: [ScreensController],
  providers: [
    { provide: CLOCK, useValue: systemClock },
    ScreensRepository,
    MenuBoardRepository,
    ManageScreens,
    PairScreenDevice,
    BuildScreenContent,
    HeartbeatScreen,
  ],
})
export class ScreensModule {}
