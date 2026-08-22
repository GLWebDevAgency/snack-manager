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
 * ÉCRAN DÉSACTIVÉ = ÉCRAN INCONNU. Un écran dont `active` est faux est refusé
 * exactement comme un jeton qui ne correspond à rien : même branche, même code,
 * même phrase. C'est mot pour mot la règle de `devices/device-access.ts`
 * (`if (!device || !device.active)`), et elle est reprise telle quelle pour
 * qu'il n'y ait jamais qu'UN comportement de refus à déboguer sur les surfaces
 * de terrain. Sans ce contrôle, le champ `active` — que `ScreenUpdateSchema` et
 * `PATCH /screens/:id` savent pourtant écrire, et que le back-office affiche —
 * ne voulait strictement rien dire : couper un écran le laissait servir la
 * carte, rafraîchie toutes les 60 secondes, indéfiniment.
 *
 * CE QUE LA TÉLÉVISION AFFICHE AU MOMENT DU REFUS. Le 401 n'arrive jamais aux
 * convives sous forme d'erreur, et c'est pour ça que c'est ce code-là et pas un
 * autre : `board-api.ts` range 401 et 403 sous `isRevoked`,
 * `use-board-content.ts` efface alors l'appairage local et lève `revoked`, et
 * `board-display.tsx` renvoie l'écran sur `/board`, c'est-à-dire sur la page
 * d'appairage — calme, à la charte, avec son pavé de six caractères. Ni trace
 * de pile, ni page blanche, ni carte figée : un écran coupé redevient un écran
 * à installer, ce qu'il est devenu. Le cache local est jeté avec l'appairage,
 * donc la carte ne réapparaît pas au redémarrage suivant.
 *
 * CE QU'ON NE FERME PAS ICI : L'ABONNEMENT. Le statut de compte du restaurant
 * n'est volontairement pas lu — voir « CE QU'UNE SUSPENSION FERME, ET CE
 * QU'ELLE LAISSE OUVERT » dans `packages/contracts/src/admin.ts`, qui nomme
 * l'écran de salle parmi les surfaces qui RESTENT OUVERTES. On ferme ce qui
 * encaisse (le back-office, l'ouverture de service au PIN, la commande en
 * ligne), on laisse ouvert ce qui affiche. Le consommateur n'est pour rien dans
 * un impayé, et un formulaire d'appairage en grand format au-dessus d'une file
 * d'attente n'accélère aucun règlement. Fermer ici serait donc une régression
 * produit, pas un correctif — `suspension.test.ts` verrouille ce point.
 *
 * Message volontairement sec : c'est une clé HDMI qui le lira, pas un humain.
 */
export async function requirePairedScreen(
  repository: ScreensRepository,
  deviceToken: string,
): Promise<StoredScreen> {
  const screen = await repository.findByDeviceToken(deviceToken);
  if (!screen || !screen.active) throw new UnauthorizedException('Écran non appairé');
  return screen;
}
