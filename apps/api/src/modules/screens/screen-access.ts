import { UnauthorizedException } from '@nestjs/common';
import type { ScreensRepository, StoredScreen } from './screens.repository';

/**
 * Authentification d'un écran.
 *
 * Un téléviseur n'a ni compte, ni mot de passe, ni personne devant lui : son
 * jeton d'appareil EST son identité, et c'est aussi lui qui porte le tenant. Le
 * `tenantId` n'apparaît donc jamais dans l'URL — un écran ne peut pas demander
 * la carte du restaurant d'à côté, même en tâtonnant.
 *
 * Message volontairement sec : c'est une clé HDMI qui le lira, pas un humain.
 */
export async function requirePairedScreen(
  repository: ScreensRepository,
  deviceToken: string,
): Promise<StoredScreen> {
  const screen = await repository.findByDeviceToken(deviceToken);
  if (!screen) throw new UnauthorizedException('Écran non appairé');
  return screen;
}
