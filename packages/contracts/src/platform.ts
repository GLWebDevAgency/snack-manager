import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Réglages de PLATEFORME — ceux de Snack Manager, pas ceux d'un restaurant.
//
// À ne pas confondre avec les réglages d'un tenant (`TenantSchema`, surface
// `/admin`) : ce qui vit ici n'appartient à aucun client, ne porte donc pas de
// `tenantId`, et se pilote depuis le CRM interne (`/sm`, rôle `sm_admin`).
//
// Premier locataire : les comptes de réseaux sociaux affichés sur notre propre
// vitrine. D'autres suivront (nom affiché, adresse de contact) — d'où le
// découpage en RUBRIQUES nommées (`social`, puis `brand`, `contact`…) plutôt
// qu'un objet plat où tout se mélange.
// ─────────────────────────────────────────────────────────────

/**
 * Identifiant du document unique de réglages.
 *
 * Partagé avec `@sm/db` (`PlatformSettingsSchema`) et avec l'API : la clé
 * primaire du document EST cette constante, ce qui rend un second document
 * impossible à insérer. Voir le commentaire du modèle.
 */
export const PLATFORM_SETTINGS_ID = 'platform';

// ─── Réseaux sociaux ───

/**
 * Les quatre réseaux, avec les identifiants DÉJÀ employés par la vitrine
 * (`RESEAUX`, apps/web/src/components/marketing/content.ts).
 *
 * Ils sont repris à l'identique pour que le branchement de la landing soit une
 * simple correspondance de clés. Une traduction (`insta`, `ig`, `linked-in`)
 * aurait imposé une table de conversion, c'est-à-dire un endroit de plus où se
 * tromper de réseau — exactement le défaut que la validation ci-dessous
 * cherche à empêcher.
 *
 * L'ordre est celui de la vitrine : il sert de rendu par défaut à l'écran de
 * saisie, pour que le CRM et la page d'accueil se lisent dans le même ordre.
 */
export const SOCIAL_NETWORKS = ['instagram', 'tiktok', 'facebook', 'linkedin'] as const;
export const SocialNetworkSchema = z.enum(SOCIAL_NETWORKS);
export type SocialNetwork = z.infer<typeof SocialNetworkSchema>;

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
};

/**
 * LES DOMAINES LÉGITIMES DE CHAQUE RÉSEAU.
 *
 * On liste les domaines ENREGISTRABLES, pas les hôtes complets : un hôte est
 * accepté s'il est égal à l'un d'eux ou s'il en est un sous-domaine. Cette
 * règle couvre d'un coup `www.`, les variantes régionales (`fr.linkedin.com`,
 * `fr-fr.facebook.com`), les versions mobiles (`m.facebook.com`) et les liens
 * de partage (`vm.tiktok.com`) sans qu'il faille les énumérer — et elle refuse
 * `instagram.com.exemple.fr`, qui ne se TERMINE pas par `.instagram.com`.
 *
 * Les raccourcisseurs maison (`instagr.am`, `fb.me`, `lnkd.in`) sont admis
 * parce qu'ils appartiennent aux réseaux eux-mêmes : les refuser rejetterait
 * une adresse honnêtement copiée depuis le bouton « Partager ».
 */
export const SOCIAL_NETWORK_DOMAINS: Record<SocialNetwork, readonly string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  tiktok: ['tiktok.com'],
  facebook: ['facebook.com', 'fb.com', 'fb.me'],
  linkedin: ['linkedin.com', 'lnkd.in'],
};

/**
 * Longueur maximale d'un lien. Aucune adresse de profil n'approche cette
 * borne ; elle n'est là que pour qu'un collage accidentel (un document entier
 * dans le champ) soit refusé net plutôt qu'écrit en base.
 */
export const SOCIAL_LINK_MAX_LENGTH = 300;

/** L'hôte relève-t-il de ce réseau ? Égalité, ou sous-domaine strict. */
function hostBelongsTo(host: string, network: SocialNetwork): boolean {
  return SOCIAL_NETWORK_DOMAINS[network].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** Le réseau auquel cet hôte appartient réellement, s'il en est un. */
function networkOfHost(host: string): SocialNetwork | null {
  return SOCIAL_NETWORKS.find((network) => hostBelongsTo(host, network)) ?? null;
}

/**
 * ═══ VIDER UN CHAMP EFFACE LE LIEN ═══
 *
 * Une chaîne vide n'est pas une URL, et surtout : `""` stocké en base est
 * *présent*. La vitrine n'affiche un pictogramme que si l'URL existe — sur
 * `""` elle afficherait donc un lien qui ne mène nulle part, soit précisément
 * le défaut qu'on veut éviter. On normalise avant toute vérification :
 * espaces rognés (un collage traîne presque toujours un espace), puis chaîne
 * vide ramenée à `null`, la seule valeur qui signifie « pas de compte ».
 */
const NormalizedLinkSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  });

/**
 * ═══ LE LIEN D'UN RÉSEAU, ET POURQUOI ON LE VÉRIFIE SI DUREMENT ═══
 *
 * Ces adresses partent en production sur la page d'accueil, sans relecture :
 * ce qui est enregistré est publié. Trois refus, chacun payé par un défaut
 * réel si on ne le fait pas ici.
 *
 * 1. HTTPS OBLIGATOIRE. Un lien `http://` posé sur une page servie en https
 *    déclenche un avertissement de sécurité dans certains navigateurs, et
 *    aucun des quatre réseaux ne se sert en clair de toute façon. La règle
 *    barre au passage `javascript:` et `data:`, qui « parsent » très bien.
 *
 * 2. L'HÔTE DOIT CORRESPONDRE AU RÉSEAU. Coller une adresse TikTok dans le
 *    champ Instagram est une erreur de copier-coller banale ; elle produit un
 *    pictogramme Instagram qui mène sur TikTok, et personne ne le voit avant
 *    qu'un client le signale. Quand l'adresse relève d'un AUTRE des quatre
 *    réseaux, le message le dit : c'est presque toujours une inversion de
 *    champ, et le lecteur doit comprendre en une phrase quoi corriger.
 *
 * 3. PAS L'ACCUEIL DU RÉSEAU. `https://instagram.com/` est une adresse
 *    parfaitement valide qui ne mène pas à notre compte. Un profil a toujours
 *    un chemin ; une racine nue est un lien à moitié copié.
 *
 * Les identifiants dans l'URL (`https://user:motdepasse@…`) sont refusés :
 * personne n'en met dans un lien de profil, et publier celui-là reviendrait à
 * afficher un secret sur la page d'accueil.
 */
export function socialLinkSchema(network: SocialNetwork) {
  const label = SOCIAL_NETWORK_LABELS[network];
  const expected = SOCIAL_NETWORK_DOMAINS[network][0];

  return NormalizedLinkSchema.superRefine((link, ctx) => {
    // `null` = pas de compte. C'est une valeur légitime, pas une erreur.
    if (link === null) return;

    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });

    if (link.length > SOCIAL_LINK_MAX_LENGTH) {
      fail(
        `Le lien ${label} est trop long (${link.length} caractères, maximum ${SOCIAL_LINK_MAX_LENGTH}). Collez uniquement l'adresse du profil.`,
      );
      return;
    }

    let url: URL;
    try {
      url = new URL(link);
    } catch {
      fail(
        `« ${link} » n'est pas une adresse web valide. Collez l'adresse complète du profil ${label}, telle qu'elle apparaît dans la barre du navigateur (elle commence par https://).`,
      );
      return;
    }

    if (url.protocol !== 'https:') {
      fail(
        `Le lien ${label} doit être en https (reçu : « ${url.protocol.replace(':', '')} »). Un lien non sécurisé sur notre page d'accueil déclenche un avertissement dans le navigateur du visiteur.`,
      );
      return;
    }

    if (url.username !== '' || url.password !== '') {
      fail(
        `Le lien ${label} contient des identifiants de connexion (la partie avant « @ »). Collez l'adresse publique du profil, sans identifiants.`,
      );
      return;
    }

    const host = url.hostname.toLowerCase();
    if (!hostBelongsTo(host, network)) {
      const actual = networkOfHost(host);
      fail(
        actual
          ? `Cette adresse mène à ${SOCIAL_NETWORK_LABELS[actual]} (${host}), pas à ${label}. Elle a probablement été collée dans le mauvais champ : un lien ${SOCIAL_NETWORK_LABELS[actual]} affiché sous le pictogramme ${label} trompe le visiteur.`
          : `Cette adresse mène à ${host}, qui n'est pas un domaine ${label}. Attendu : ${expected} (ou l'un de ses sous-domaines).`,
      );
      return;
    }

    if (url.pathname === '' || url.pathname === '/') {
      fail(
        `Cette adresse mène à l'accueil de ${label}, pas à notre compte. Le lien d'un profil comporte un chemin, par exemple https://${expected}/snackmanager.`,
      );
    }
  });
}

/**
 * Les quatre liens tels qu'ils sont STOCKÉS et RENDUS par l'API.
 *
 * Les quatre clés sont toujours présentes, `null` valant « pas de compte ».
 * L'API ne rend jamais un objet partiel : la vitrine n'aurait alors aucun
 * moyen de distinguer « pas encore chargé » de « pas de compte », et la
 * différence est exactement ce qui décide de l'affichage.
 */
export type PlatformSocialLinks = Record<SocialNetwork, string | null>;

/** État de départ : aucun compte publié. Rendu quand le document n'existe pas encore. */
export const EMPTY_SOCIAL_LINKS: PlatformSocialLinks = {
  instagram: null,
  tiktok: null,
  facebook: null,
  linkedin: null,
};

/** Les réglages de plateforme rendus par l'API, rubrique par rubrique. */
export type PlatformSettings = {
  social: PlatformSocialLinks;
  updatedAt: string | null;
};

/**
 * Mise à jour PARTIELLE des liens.
 *
 * Écrit à la main, sans un seul `.default()` — même piège que
 * `ProductUpdateSchema` et `LeadUpdateSchema` : un `.partial()` dérivé d'un
 * schéma à défauts réintroduit les champs absents et écrase ce qu'on n'a pas
 * touché. Ici la distinction porte tout le comportement de l'écran :
 *
 *   · clé ABSENTE  → ce réseau n'est pas modifié ;
 *   · clé à `null` (ou chaîne vide) → le lien est EFFACÉ, le pictogramme
 *     disparaît de la vitrine.
 *
 * Sans cette distinction, il n'existerait aucune façon de retirer un compte
 * autrement qu'en réécrivant les quatre champs.
 */
export const PlatformSocialLinksUpdateSchema = z.object({
  instagram: socialLinkSchema('instagram').optional(),
  tiktok: socialLinkSchema('tiktok').optional(),
  facebook: socialLinkSchema('facebook').optional(),
  linkedin: socialLinkSchema('linkedin').optional(),
});
export type PlatformSocialLinksUpdate = z.infer<typeof PlatformSocialLinksUpdateSchema>;

/**
 * Le corps du PATCH des réglages de plateforme.
 *
 * La rubrique est explicite (`{ social: { … } }`) et non aplatie : le jour où
 * `brand` et `contact` arrivent, ils s'ajoutent sans renommer une seule clé
 * existante, et une requête qui ne touche qu'aux réseaux ne mentionne toujours
 * que `social`.
 */
export const PlatformSettingsUpdateSchema = z.object({
  social: PlatformSocialLinksUpdateSchema.optional(),
});
export type PlatformSettingsUpdate = z.infer<typeof PlatformSettingsUpdateSchema>;
