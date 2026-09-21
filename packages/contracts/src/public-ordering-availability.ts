import { z } from 'zod';
import { PickupSlotSchema, SlotsResponseSchema } from './ordering';

const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const serviceHours = z.strictObject({ open: wallTime, close: wallTime });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Volatile public facts only: refreshing them must not replace a checkout's brand or catalogue. */
export const PublicOrderingAvailabilitySchema = z.strictObject({
  /** Start of the server observation, never extended by a slow response. */
  observedAt: z.iso.datetime(),
  openNow: z.boolean(),
  ordering: z.strictObject({ paused: z.boolean(), message: z.string().max(200).nullable() }),
  todayHours: z.strictObject({
    day: z.number().int().min(1).max(7),
    lunch: serviceHours.nullable(),
    dinner: serviceHours.nullable(),
  }).nullable(),
  timezone: z.string().min(1).max(80),
  slots: SlotsResponseSchema.extend({
    date: day,
    nextOpenDate: day.nullable(),
    timezone: z.string().min(1).max(80),
    slots: z.array(PickupSlotSchema.extend({ iso: z.iso.datetime(), label: wallTime }).strict()),
  }).strict(),
});
export type PublicOrderingAvailability = z.infer<typeof PublicOrderingAvailabilitySchema>;
