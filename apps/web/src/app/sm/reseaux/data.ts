"use client";

/**
 * DONNÉES DE L'ÉCRAN « RÉSEAUX SOCIAUX » — back-office INTERNE Snack Manager.
 *
 * ─── La question de l'écran ───
 *
 * « Quels comptes de réseaux sociaux la vitrine affiche-t-elle en ce moment,
 * et lesquels dois-je publier ou retirer ? » Ce sont NOS comptes, ceux de
 * Snack Manager, pas ceux d'un restaurant : le réglage est de niveau
 * PLATEFORME et n'appartient à aucun client. D'où sa place dans `/sm` et non
 * dans `/admin`.
 *
 * ─── Cloisonnement ───
 *
 * `GET` et `PATCH /crm/platform/settings` exigent `sm_admin` côté API. La
 * coquille `/sm` renvoie un gérant chez lui avant l'affichage, mais la garde
 * qui compte reste le 403.
 *
 * ─── Ce qui est enregistré est PUBLIÉ ───
 *
 * Aucune relecture ne s'intercale entre ce formulaire et la page d'accueil de
 * l'entreprise. La validation est donc faite DEUX fois avec le MÊME schéma
 * (`PlatformSettingsUpdateSchema`, @sm/contracts) : ici pour que l'erreur
 * s'affiche sous le champ fautif sans aller-retour réseau, et côté API parce
 * que c'est la seule vérification qui protège vraiment. Un seul schéma, donc
 * un seul texte de message : ce que l'écran affiche est exactement ce que
 * l'API aurait répondu.
 */

import {
  PlatformSettingsUpdateSchema,
  SOCIAL_NETWORKS,
  type PlatformSettings,
  type PlatformSocialLinks,
  type PlatformSocialLinksUpdate,
  type SocialNetwork,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";

/** Un message d'erreur par réseau — la forme que l'écran sait afficher. */
export type SocialErrors = Partial<Record<SocialNetwork, string>>;

export const platformApi = {
  settings: () => api.get<PlatformSettings>("/crm/platform/settings"),
  save: (social: PlatformSocialLinksUpdate) =>
    api.patch<PlatformSettings>("/crm/platform/settings", { social }),
};

/**
 * Valide la saisie AVANT l'envoi, et rend une erreur par champ.
 *
 * LES QUATRE CHAMPS SONT VÉRIFIÉS, SEULS LES CHAMPS MODIFIÉS SONT ENVOYÉS.
 *
 * Vérifier les quatre : ils sont tous à l'écran, et un refus doit apparaître
 * sous celui qui le mérite, qu'on vienne de le taper ou non.
 *
 * N'envoyer que ce qui a bougé : c'est la distinction que le contrat porte —
 * clé absente = ce réseau n'est pas modifié, clé vide = le lien est EFFACÉ.
 * Renvoyer les quatre à chaque fois écraserait, sans le vouloir, ce qu'un
 * autre onglet vient d'enregistrer ; et le journal ne saurait plus dire ce qui
 * a réellement changé.
 */
export function validate(
  draft: Record<SocialNetwork, string>,
  saved: PlatformSocialLinks,
): {
  errors: SocialErrors;
  body: PlatformSocialLinksUpdate | null;
} {
  const social = Object.fromEntries(
    SOCIAL_NETWORKS.map((network) => [network, draft[network]]),
  );
  const parsed = PlatformSettingsUpdateSchema.safeParse({ social });

  if (parsed.success) {
    const validated = parsed.data.social ?? {};
    const body: PlatformSocialLinksUpdate = {};
    for (const network of SOCIAL_NETWORKS) {
      // `validated[network]` est la valeur NORMALISÉE (rognée, vide ramenée à
      // `null`) : c'est elle qu'il faut comparer, sinon un espace en fin de
      // ligne passerait pour une modification.
      if ((validated[network] ?? null) !== saved[network]) {
        body[network] = validated[network] ?? null;
      }
    }
    return { errors: {}, body };
  }

  const errors: SocialErrors = {};
  for (const issue of parsed.error.issues) {
    // Chemin `['social', 'instagram']` : le second segment nomme le réseau.
    // Premier message gagnant — afficher le second refus d'un même champ
    // ferait corriger une faute qui n'est pas encore la bonne.
    const network = issue.path[1];
    if (isNetwork(network) && !errors[network]) errors[network] = issue.message;
  }
  return { errors, body: null };
}

/**
 * Les refus de l'API, remis dans la même forme.
 *
 * Le serveur revalide ce que l'écran a déjà validé — et c'est bien ainsi : sa
 * réponse peut différer si le contrat a bougé pendant que l'onglet était
 * ouvert. Ses messages sont rédigés en français pour être AFFICHÉS ; on les
 * repose sous le bon champ plutôt que d'en faire une bannière générale.
 */
export function readApiErrors(error: unknown): { errors: SocialErrors; global: string | null } {
  if (!(error instanceof ApiError)) {
    return {
      errors: {},
      // Ni 4xx ni 5xx : la requête n'est jamais partie. Le dire, plutôt que
      // laisser croire que la saisie est fautive.
      global: "Enregistrement impossible — vérifiez votre connexion et réessayez.",
    };
  }

  const body = error.body as { issues?: { path?: string; message?: string }[] } | null;
  const errors: SocialErrors = {};
  for (const issue of body?.issues ?? []) {
    const network = String(issue.path ?? "").split(".")[1];
    if (isNetwork(network) && !errors[network] && issue.message) {
      errors[network] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0) return { errors, global: null };

  if (error.status === 403) {
    return {
      errors: {},
      global: "Votre compte n’a pas le droit de modifier les réseaux de la vitrine.",
    };
  }
  const message = error.message?.trim();
  return {
    errors: {},
    global:
      message && message !== "Validation failed"
        ? message
        : "Enregistrement impossible — réessayez dans un instant.",
  };
}

/** Les liens tels qu'on les édite : jamais `null` dans un `<input>` contrôlé. */
export const toDraft = (links: PlatformSocialLinks): Record<SocialNetwork, string> =>
  Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, links[n] ?? ""])) as Record<
    SocialNetwork,
    string
  >;

/** La saisie a-t-elle bougé depuis le dernier enregistrement ? */
export const hasChanged = (
  draft: Record<SocialNetwork, string>,
  saved: PlatformSocialLinks,
): boolean => SOCIAL_NETWORKS.some((n) => draft[n].trim() !== (saved[n] ?? ""));

function isNetwork(value: unknown): value is SocialNetwork {
  return (SOCIAL_NETWORKS as readonly string[]).includes(String(value));
}
