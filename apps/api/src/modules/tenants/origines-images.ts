import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * D'OÙ UNE IMAGE DE MASQUE A LE DROIT DE VENIR.
 *
 * `ImageUrl` (contrat) refuse les schémas dangereux — `javascript:`, `data:` —
 * et rien de plus : toute origine http(s) passait. Or les deux routes
 * `PATCH …/marque` (celle du restaurateur et celle de l'équipe SM) écrivent
 * `logo.mark`, `logo.lockup` et `hero` DIRECTEMENT, et ces URL finissent en
 * `src` sur la vitrine du restaurant, sur sa carte de fidélité, sur son
 * tableau de menu et jusque dans l'icône de son manifeste. Un `owner` pouvait
 * donc faire télécharger l'image de son choix, depuis l'hôte de son choix, par
 * TOUS ses clients : l'hôte tiers voit alors leur IP et leur navigateur, et
 * décide de ce qui s'affiche — le jour où il change le fichier, la vitrine
 * change avec, sans que rien ne passe par nous.
 *
 * Le contrat ne peut pas porter cette liste : il ne connaît ni le domaine
 * public du déploiement ni l'hôte du magasin d'images. Elle vit donc ici, avec
 * la politique d'images (formats, taille, clefs) que ce module tient déjà.
 *
 * ═══ CE QUI EST AUTORISÉ ═══
 *
 *  - `PUBLIC_ROOT_DOMAIN` et ses sous-domaines. C'est notre domaine public, et
 *    c'est là que les logos sont servis : `logoUrl` pointe vers NOTRE route
 *    (`/public/tenants/<slug>/logo?v=…`, cf. `logo.service.ts`), jamais vers
 *    R2 en direct. La variable est déjà OBLIGATOIRE (`SiteConfig`) : la liste
 *    n'est donc jamais vide par oubli.
 *  - `SM_IMAGE_ORIGINS`, liste séparée par des virgules, pour ce qui n'est pas
 *    sous ce domaine : le magasin d'images du projet le jour où il sert par
 *    son propre domaine (bucket R2 public), et l'API de développement
 *    (`localhost:3001`), qui n'est sous aucun domaine public.
 *
 * Un hôte ou une origine complète y sont admis indifféremment
 * (`images.exemple.fr` comme `http://localhost:3001`) : seul l'HÔTE est
 * comparé. Le port ne l'est pas — il ne dit rien de qui contrôle le contenu —
 * et le schéma est déjà borné à http(s) par le contrat.
 *
 * ═══ CE QUE CETTE GARDE NE FAIT PAS ═══
 *
 * Elle garde les deux routes `PATCH …/marque`, où une URL est REÇUE. Elle ne
 * couvre pas `PUT /tenants/me/logo`, qui n'en reçoit aucune : il FABRIQUE la
 * sienne à partir de l'hôte de la requête (`logo.controller.ts`,
 * `X-Forwarded-Host` puis `Host`). Cet hôte-là mériterait sa propre
 * vérification — c'est une question d'en-tête de requête et de confiance au
 * proxy, pas d'origine reçue d'un éditeur, et elle ne se traite pas ici.
 *
 * Elle ne s'applique qu'à l'ÉCRITURE. La LECTURE (`lireMarque`) reste
 * tolérante, et c'est délibéré : un masque déjà stocké qui pointerait ailleurs
 * ne doit pas devenir invalide d'un déploiement à l'autre — il basculerait
 * tout le restaurant sur le repli Nuit, sur un 200, sans que personne l'ait
 * demandé. Ce qui est en base y reste jusqu'à la prochaine écriture ; c'est la
 * prochaine écriture qui le refuse.
 */
@Injectable()
export class OriginesImages {
  readonly hotes: readonly string[];

  constructor(config: ConfigService) {
    this.hotes = hotesDImages(
      config.get<string>('PUBLIC_ROOT_DOMAIN'),
      config.get<string>('SM_IMAGE_ORIGINS'),
    );
  }
}

/**
 * L'hôte d'une URL, ou `null` si ce n'en est pas une.
 *
 * `new URL` fait le travail délicat, et c'est pour ça qu'on ne découpe pas la
 * chaîne à la main : l'hôte de `https://mechant.fr@exemple.fr/x` est
 * `exemple.fr` (l'user-info n'est pas l'hôte), et un port ou une adresse IPv6
 * littérale ne se retirent pas au premier `:`.
 */
function hoteDeLUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Une entrée de CONFIGURATION ramenée à son hôte.
 *
 * `https://images.exemple.fr/logos/`, `images.exemple.fr` et `localhost:3001`
 * doivent désigner la même chose que ce qu'on a sous les yeux : on écrit une
 * adresse d'images comme on l'écrit, pas comme un parseur l'attend. D'où la
 * seconde tentative, préfixée — ce qui ne ressemble toujours à rien est jeté.
 */
function hoteDe(brut: string): string | null {
  const nettoye = brut.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (nettoye === '') return null;
  return hoteDeLUrl(nettoye) ?? hoteDeLUrl(`https://${nettoye}`);
}

/**
 * La liste effective, dédoublonnée : le domaine public d'abord, les origines
 * déclarées ensuite.
 *
 * Elle LÈVE si elle est vide, sur le modèle de `SiteConfig` : une liste vide
 * refuserait toute image de masque, y compris le logo que le restaurateur
 * vient de déposer chez nous. Mieux vaut une API qui ne démarre pas, tout de
 * suite et bruyamment, qu'un éditeur de marque qui refuse tout sans que
 * personne ne sache pourquoi.
 */
export function hotesDImages(
  racinePublique: string | undefined,
  origines: string | undefined,
): readonly string[] {
  const hotes = [racinePublique ?? '', ...(origines ?? '').split(',')]
    .map(hoteDe)
    .filter((h): h is string => h !== null);
  const uniques = [...new Set(hotes)];

  if (uniques.length === 0) {
    throw new Error(
      "Aucune origine d'images autorisée : PUBLIC_ROOT_DOMAIN est vide et " +
        "SM_IMAGE_ORIGINS ne dit rien. Sans liste, l'éditeur de marque " +
        'refuserait jusqu’au logo hébergé chez nous.',
    );
  }
  return uniques;
}

/**
 * L'URL vient-elle d'un hôte autorisé ?
 *
 * Le suffixe est comparé AVEC son point : sans lui, `evilexemple.fr` passerait
 * pour un sous-domaine d'`exemple.fr`. Et `exemple.fr.mechant.fr` n'est ni
 * égal à la racine ni un de ses sous-domaines — il ne passe donc pas non plus.
 * Une chaîne qui n'est pas une URL n'est jamais autorisée : ce qu'on n'a pas
 * su lire, on ne le sert pas.
 */
export function imageAutorisee(url: string, hotes: readonly string[]): boolean {
  const hote = hoteDeLUrl(url);
  if (hote === null) return false;
  return hotes.some((autorise) => hote === autorise || hote.endsWith(`.${autorise}`));
}
