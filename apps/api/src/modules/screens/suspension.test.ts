import { beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { BuildScreenContent } from './build-screen-content.usecase';
import { HeartbeatScreen } from './heartbeat-screen.usecase';
import {
  FakeMenuBoardRepository,
  FakeScreensRepository,
  TestClock,
  storedScreen,
} from './screens.fakes';

const TOKEN = 'scr_tok_desactivation';
const TENANT = '65f000000000000000000001';
const START = '2026-08-19T12:00:00Z';

/**
 * COUPER UN ÉCRAN DE SALLE DÉJÀ ACCROCHÉ AU MUR.
 *
 * Même trou que celui refermé côté caisse par `devices/suspension.test.ts` :
 * une télévision ne présente pas de JWT pour vivre, elle présente son jeton
 * d'appareil, qui ne traverse pas le guard global. `screen-access.ts` ne lisait
 * pas `active` — si bien que le champ, pourtant écrit par `PATCH /screens/:id`
 * et rendu au back-office, ne coupait rien du tout : l'écran continuait de
 * recharger la carte toutes les 60 secondes, indéfiniment.
 *
 * CE QUI N'EST PAS TESTÉ ICI, ET POURQUOI. Il n'y a volontairement aucun test
 * « abonnement suspendu ⇒ écran refusé », parce que ce n'est pas la règle :
 * `packages/contracts/src/admin.ts` range explicitement l'écran de salle parmi
 * les surfaces qui RESTENT OUVERTES pendant une suspension — on ferme ce qui
 * encaisse, on laisse ouvert ce qui affiche. Éteindre la télé au-dessus d'une
 * file d'attente n'accélère aucun règlement, ça humilie le restaurateur devant
 * ses clients et ça donne de nous l'image d'un logiciel en panne. Le dernier
 * test du fichier verrouille cette forme de réponse : elle ne transporte aucun
 * signal de suspension, et n'a pas à en transporter.
 */
describe('Écran de salle désactivé depuis le back-office', () => {
  let clock: TestClock;
  let screens: FakeScreensRepository;
  let board: FakeMenuBoardRepository;
  let content: BuildScreenContent;
  let heartbeat: HeartbeatScreen;

  beforeEach(() => {
    clock = new TestClock(new Date(START));
    screens = new FakeScreensRepository();
    board = new FakeMenuBoardRepository();
    // `StoredScreen` ne porte pas le jeton — il n'a rien à faire dans une vue
    // de lecture. Le dépôt en mémoire l'accepte donc à part, comme le ferait
    // l'appairage.
    screens.seed(storedScreen({ id: 'screen-1', tenantId: TENANT }), TOKEN);
    content = new BuildScreenContent(clock, screens.asRepository(), board.asRepository());
    heartbeat = new HeartbeatScreen(clock, screens.asRepository(), board.asRepository());
  });

  it('sert la carte tant que l’écran est actif', async () => {
    const painted = await content.execute(TOKEN);

    expect(painted.brand.name).toBe("Class'Food");
    expect(painted.scenes.length).toBeGreaterThan(0);
  });

  it('cesse de servir la carte dès que l’écran est désactivé', async () => {
    await screens.update(TENANT, 'screen-1', { active: false });

    // C'est le défaut : sans ce refus, la télévision d'un client qu'on vient de
    // couper continue d'afficher une carte VIVANTE, rafraîchie toutes les
    // 60 secondes. Du service payant livré gratuitement.
    await expect(content.execute(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('coupe aussi le battement de cœur, pas seulement le contenu', async () => {
    await screens.update(TENANT, 'screen-1', { active: false });

    // Les deux surfaces publiques passent par `requirePairedScreen` : en
    // refuser une seule laisserait l'écran signaler sa présence au back-office
    // comme un écran en service.
    await expect(heartbeat.execute(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('ne date plus le dernier signe de vie d’un écran coupé', async () => {
    await screens.update(TENANT, 'screen-1', { active: false });

    await expect(heartbeat.execute(TOKEN)).rejects.toThrow();

    // Le refus tombe AVANT `touch` : un écran coupé ne doit pas remonter « en
    // ligne » dans la liste du back-office, sinon le gérant croit l'avoir
    // manqué et remonte sur son escabeau.
    const screen = await screens.byId(TENANT, 'screen-1');
    expect(screen?.lastSeenAt).toBeNull();
  });

  it('refuse un écran désactivé EXACTEMENT comme un jeton inconnu', async () => {
    await screens.update(TENANT, 'screen-1', { active: false });

    const refused = await content.execute(TOKEN).catch((e: unknown) => e);
    const unknown = await content.execute('scr_tok_inexistant').catch((e: unknown) => e);

    // Même règle et même code de refus que `devices/device-access.ts`
    // (`if (!device || !device.active)`) : deux surfaces qui refusent
    // différemment sont deux surfaces à déboguer séparément. Et c'est un 401
    // parce que c'est le seul code que la clé HDMI sait traiter proprement —
    // `board-api.ts` le range sous `isRevoked`, l'appairage local est effacé et
    // la télévision bascule sur la page d'appairage à la charte. Ni trace de
    // pile, ni page blanche devant les convives.
    expect(refused).toBeInstanceOf(UnauthorizedException);
    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect((refused as UnauthorizedException).getStatus()).toBe(401);
    expect((refused as UnauthorizedException).message).toBe(
      (unknown as UnauthorizedException).message,
    );
  });

  it('réactiver l’écran le remet à l’antenne, sans réappairage', async () => {
    await screens.update(TENANT, 'screen-1', { active: false });
    await expect(content.execute(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);

    await screens.update(TENANT, 'screen-1', { active: true });

    // Rien à retaper sur un escabeau : le jeton n'a jamais été révoqué, seul le
    // service l'était. Régénérer un code reste le geste des clés HDMI volées.
    await expect(content.execute(TOKEN)).resolves.toMatchObject({ brand: { name: "Class'Food" } });
  });

  it('le battement d’un écran en service ne transporte aucun signal de suspension', async () => {
    const result = await heartbeat.execute(TOKEN);

    // La caisse, elle, reçoit `suspended: true` pour verrouiller son écran
    // avant d'échouer devant un client au moment d'encaisser
    // (`devices/suspension.test.ts`). L'écran de salle n'a rien à verrouiller :
    // il affiche. Ajouter ici un drapeau de suspension — ou pire, un refus —
    // finirait en formulaire d'appairage plein écran au-dessus de la file
    // d'attente, et le code que le gérant y saisirait ne marcherait pas
    // davantage.
    expect(result.ok).toBe(true);
    expect('suspended' in result).toBe(false);
    expect(result.contentHash).toEqual(expect.any(String));
  });
});
