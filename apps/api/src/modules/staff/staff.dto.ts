import { z } from 'zod';

/**
 * DTO zod LOCAUX au module staff (décision mission : pas dans @sm/contracts
 * pour éviter les conflits de rebuild entre agents).
 */

export const StaffRoleSchema = z.enum(['gerant', 'caisse', 'cuisine']);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

/** PIN de badge/login POS : 4 à 6 chiffres, unique dans le tenant. */
const PinSchema = z.string().regex(/^\d{4,6}$/, 'PIN : 4 à 6 chiffres');

const NameSchema = z.string().trim().min(1, 'Nom requis').max(80);

export const StaffCreateSchema = z.object({
  name: NameSchema,
  role: StaffRoleSchema,
  pin: PinSchema,
});
export type StaffCreate = z.infer<typeof StaffCreateSchema>;

export const StaffUpdateSchema = z
  .object({
    name: NameSchema,
    role: StaffRoleSchema,
    active: z.boolean(),
    /** Optionnel — re-hashé (argon2) si fourni. */
    pin: PinSchema,
  })
  .partial();
export type StaffUpdate = z.infer<typeof StaffUpdateSchema>;

export const ClockSchema = z.object({ direction: z.enum(['in', 'out']) });
export type Clock = z.infer<typeof ClockSchema>;

/** Paramètre de date en query string : '' ou absent → undefined, sinon Date. */
const DateParam = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.coerce.date().optional(),
);

export const ShiftsQuerySchema = z.object({
  from: DateParam,
  to: DateParam,
});
export type ShiftsQuery = z.infer<typeof ShiftsQuerySchema>;
