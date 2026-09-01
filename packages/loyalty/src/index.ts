export * from './schema';
export * from './client';
export * from './crypto';
// Les prédicats utilisés avec les tables exportées doivent provenir de la
// même instance typée de Drizzle. Les réexporter évite que pnpm charge deux
// déclarations nominales incompatibles dans une application consommatrice.
export { and, desc, eq, gt, gte, isNull, lt, or, sql } from 'drizzle-orm';
export { alias } from 'drizzle-orm/pg-core';
export { migrate as migrateLoyaltySchema } from 'drizzle-orm/node-postgres/migrator';
