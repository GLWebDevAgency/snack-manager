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
 * Le logo n'y est pas : il exige un hébergement de fichiers qui n'existe pas
 * encore — un champ URL nu inviterait des liens morts sur les tickets.
 * Le slug n'y est pas non plus : c'est l'adresse publique de l'établissement,
 * la changer casse la fiche Google et les QR imprimés — geste d'équipe SM.
 */
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
