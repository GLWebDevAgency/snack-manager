import { z } from 'zod';

/**
 * IDENTITÉ DE L'ÉTABLISSEMENT — éditable par le gérant, enfin.
 *
 * Jusqu'au 24/08/2026, le nom, la couleur de marque, l'adresse et les
 * téléphones étaient consommés PARTOUT (caisse, cuisine, vitrine, tickets)
 * et éditables NULLE PART : chaque changement retombait sur l'équipe SM, en
 * base (diagnostic quatre casquettes, P2). Ce contrat arme l'écran
 * « Paramètres » du back-office restaurateur.
 *
 * Le logo n'est pas DANS ce PATCH : ce n'est pas un champ URL (un champ nu
 * inviterait des liens morts sur les tickets) mais un FICHIER, envoyé sur sa
 * propre route (`PUT /tenants/me/logo`, multipart) et hébergé par nous sur
 * R2 — seules les bornes ci-dessous sont partagées entre l'écran et l'API.
 * Le slug n'y est pas non plus : c'est l'adresse publique de l'établissement,
 * la changer casse la fiche Google et les QR imprimés — geste d'équipe SM.
 */

/**
 * Taille maximale du logo : 512 Ko. Un logo sert en en-tête de ticket, sur
 * une tablette de caisse et un board TV — au-delà, c'est une photo, pas un
 * logo, et c'est la page de commande de tous ses clients qui la télécharge.
 * L'écran vérifie AVANT d'envoyer (message immédiat), l'API refuse ensuite
 * (la limite qui compte) : même nombre des deux côtés, donc partagé ici.
 */
export const LOGO_MAX_OCTETS = 512 * 1024;

/** Formats admis — pas de SVG : un SVG embarque du script, un logo non. */
export const LOGO_FORMATS_ADMIS = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const TenantIdentityUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** L'accent de marque — seul levier de personnalisation (charte DA §3). */
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur attendue au format #rrggbb')
    .optional(),
  address: z.string().trim().max(200).optional(),
  /** Tels qu'ils s'impriment sur le ticket — le format reste libre. */
  phones: z.array(z.string().trim().min(1).max(20)).max(3).optional(),
});
export type TenantIdentityUpdate = z.infer<typeof TenantIdentityUpdateSchema>;
