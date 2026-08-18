import { z } from 'zod';

/**
 * DTO zod locaux au module « Votre site web » — périmètre interne au
 * back-office gérant, rien à partager avec la caisse ni la commande en ligne.
 *
 * Volontairement permissif : la VRAIE validation du nom de domaine est une
 * règle métier, elle vit dans `PublicDomain.create` (@sm/domain). Zod ne fait
 * ici que garantir la forme du body — sinon la même règle existerait à deux
 * endroits et divergerait.
 */

export const DomainAddSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1, 'Indiquez un nom de domaine')
    .max(253, 'Nom de domaine trop long'),
});
export type DomainAdd = z.infer<typeof DomainAddSchema>;
