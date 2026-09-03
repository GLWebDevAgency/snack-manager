import { Logger } from '@nestjs/common';
import { lireMarque, type Brand, type RepliMarque } from '@sm/contracts';

/**
 * LE REPLI « INVALIDE » NE DOIT PLUS ÊTRE MUET.
 *
 * `lireMarque` distingue depuis peu deux replis : « absent » — le tenant n'a
 * pas encore été repris, c'est l'état NORMAL d'avant `backfill:brand` — et
 * « invalide » — il a un masque, la base le porte, et il ne passe pas le
 * contrat. Le second est un incident : le restaurant s'affiche en Nuit sur
 * TOUTES ses surfaces clientes (vitrine, commande, fidélité, tableau de menu),
 * sur un 200, et personne ne le sait. L'API rendait la même chose dans les
 * deux cas et ne disait rien ni dans l'un ni dans l'autre.
 *
 * Cet adaptateur est le SEUL point de lecture du masque côté API : il rend
 * exactement ce que `lireMarque` rend, et journalise le cas « invalide ».
 * Le cas « absent » ne journalise RIEN — un parc pas encore repris ferait
 * sinon un journal illisible dès le premier service.
 *
 * ═══ LE VOLUME EST UNE PARTIE DU PROBLÈME ═══
 *
 * Ces lectures vivent sur des surfaces PUBLIQUES très visitées : la page de
 * commande d'un restaurant, son tableau de menu (rafraîchi en boucle), sa
 * carte de fidélité. Un avertissement par requête serait un défaut de plus —
 * il noierait le journal et coûterait exactement là où ça compte. Un
 * établissement ne se signale donc qu'UNE FOIS par fenêtre : le message dit un
 * ÉTAT persistant, pas un événement, et le répéter n'apprend rien.
 *
 * La mémoire est celle du PROCESSUS : plusieurs répliques signalent chacune
 * une fois, un redémarrage resignale. C'est voulu — un compteur partagé
 * (Redis) pour une ligne de journal ajouterait une dépendance sur un chemin de
 * lecture publique, et le drapeau de la fiche CRM (`brandRepli`) est de toute
 * façon la vue qu'un humain consulte.
 */

/** Le document tel qu'il arrive des dépôts — projeté, hydraté ou `.lean()`. */
type TenantLu = {
  _id?: unknown;
  slug?: unknown;
  brand?: unknown;
  brandColor?: string | null;
  logoUrl?: string | null;
};

const journal = new Logger('Masque');

/** Une heure : assez long pour ne pas répéter en service, assez court pour resignaler dans la journée. */
export const FENETRE_ALERTE_MASQUE_MS = 60 * 60_000;

/** Au-delà, la mémoire est purgée : elle sert à se taire, pas à tenir un inventaire. */
const MAX_ETABLISSEMENTS_SUIVIS = 1_000;

const derniereAlerte = new Map<string, number>();

/** De quel établissement parle-t-on — le slug d'abord, il se lit. */
function identite(t: TenantLu): string {
  const slug = typeof t.slug === 'string' && t.slug !== '' ? t.slug : null;
  return slug ?? (t._id == null ? 'établissement inconnu' : String(t._id));
}

function signaler(t: TenantLu, maintenant: number): void {
  const clef = identite(t);
  const vue = derniereAlerte.get(clef);
  if (vue !== undefined && maintenant - vue < FENETRE_ALERTE_MASQUE_MS) return;

  if (derniereAlerte.size >= MAX_ETABLISSEMENTS_SUIVIS) {
    for (const [autre, quand] of derniereAlerte) {
      if (maintenant - quand >= FENETRE_ALERTE_MASQUE_MS) derniereAlerte.delete(autre);
    }
    if (derniereAlerte.size >= MAX_ETABLISSEMENTS_SUIVIS) derniereAlerte.clear();
  }
  derniereAlerte.set(clef, maintenant);

  journal.warn(
    `Masque illisible en base pour « ${clef} » — repli Nuit servi sur toutes ses ` +
      'surfaces clientes. Le document ne passe pas BrandSchema : reprendre le ' +
      'masque (éditeur de marque ou `pnpm --filter @sm/db backfill:brand`).',
  );
}

/**
 * Le masque effectif ET la raison du repli, journalisée si elle est anormale.
 *
 * À préférer partout où l'appelant a quelque chose à faire de `repli` — la
 * fiche client du CRM, qui en fait un drapeau visible.
 */
export function lireMarqueObservee(
  t: TenantLu,
  maintenant: number = Date.now(),
): { brand: Brand; repli: RepliMarque } {
  const lu = lireMarque(t);
  if (lu.repli === 'invalide') signaler(t, maintenant);
  return lu;
}

/** Le raccourci pour les surfaces qui n'ont besoin que du masque — la plupart. */
export const marqueObservee = (t: TenantLu, maintenant?: number): Brand =>
  lireMarqueObservee(t, maintenant).brand;

/** Réservé aux tests : la mémoire du silence est un état de processus. */
export function oublierAlertesMasque(): void {
  derniereAlerte.clear();
}
