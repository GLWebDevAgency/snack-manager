import { z } from 'zod';

const id = z.uuid({ version: 'v4' });
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const DiningTableSchema = z.object({
  id, label: z.string().trim().min(1).max(40), seats: z.number().int().min(1).max(100),
  active: z.boolean(), revision,
}).strict();
export type DiningTable = z.infer<typeof DiningTableSchema>;
export const DiningSessionSchema = z.object({
  id, tableId: id, tableLabel: z.string().min(1).max(40), guestCount: z.number().int().min(1).max(100),
  revision, state: z.enum(['open', 'closed']), openedAt: z.iso.datetime(), closedAt: z.iso.datetime().nullable(),
  orderIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(200),
  pendingOperationCount: z.number().int().min(0).max(200),
}).strict();
export type DiningSession = z.infer<typeof DiningSessionSchema>;
export const DiningRoomSchema = z.object({ tables: z.array(DiningTableSchema).max(200), sessions: z.array(DiningSessionSchema).max(200) }).strict();
export type DiningRoom = z.infer<typeof DiningRoomSchema>;
export const DiningTableCreateSchema = z.object({ operationId: id, label: DiningTableSchema.shape.label, seats: DiningTableSchema.shape.seats }).strict();
export const DiningTableUpdateSchema = z.object({ operationId: id, expectedRevision: revision,
  label: DiningTableSchema.shape.label.optional(), seats: DiningTableSchema.shape.seats.optional(), active: z.boolean().optional(),
}).strict().refine((body) => body.label !== undefined || body.seats !== undefined || body.active !== undefined, 'Aucun changement de table');
export const DiningSessionOpenSchema = z.object({ operationId: id, tableId: id, guestCount: DiningSessionSchema.shape.guestCount }).strict();
export const DiningSessionOperationSchema = z.object({ operationId: id, expectedRevision: revision }).strict();
export const DiningSessionTransferSchema = DiningSessionOperationSchema.extend({ tableId: id }).strict();
export const DiningServeSchema = z.object({ operationId: id }).strict();
export type DiningServe = z.infer<typeof DiningServeSchema>;
export const OrderDiningSchema = z.object({ sessionId: id, tableId: id, tableLabel: z.string().min(1).max(40), servedAt: z.iso.datetime().nullable().optional() }).strict();
export type OrderDining = z.infer<typeof OrderDiningSchema>;
export type DiningTableCreate = z.infer<typeof DiningTableCreateSchema>;
export type DiningTableUpdate = z.infer<typeof DiningTableUpdateSchema>;
export type DiningSessionOpen = z.infer<typeof DiningSessionOpenSchema>;
export type DiningSessionOperation = z.infer<typeof DiningSessionOperationSchema>;
export type DiningSessionTransfer = z.infer<typeof DiningSessionTransferSchema>;
