export type ManagedObjectKind = 'schema' | 'table' | 'sequence' | 'type' | 'function';
export type MigrationJournal = 'supply' | 'loyalty' | 'customer';

export type ManagedObject = Readonly<{
  kind: ManagedObjectKind;
  schema: string;
  name: string;
  identityArguments: string;
  journal?: MigrationJournal;
  introducedAt?: number;
}>;

export const SUPPLY_INITIAL_MIGRATION = 1_787_074_510_723;
export const LOYALTY_INITIAL_MIGRATION = 1_788_230_085_055;
export const LOYALTY_EARN_RECEIPTS_MIGRATION = 1_788_236_557_128;
export const CUSTOMER_INITIAL_MIGRATION = 1_788_854_400_000;
export const CUSTOMER_PAID_BUDGET_MIGRATION = 1_788_861_600_000;
export const CUSTOMER_BROWSER_CONTINUITY_MIGRATION = 1_788_870_000_000;
export const CUSTOMER_BROWSER_PREPARATION_MIGRATION = 1_788_894_000_000;
export const CUSTOMER_VERIFICATION_INTENTS_MIGRATION = 1_788_901_200_000;

const managed = (
  kind: ManagedObjectKind,
  schema: string,
  name: string,
  options: Pick<ManagedObject, 'journal' | 'introducedAt'> = {},
): ManagedObject => ({ kind, schema, name, identityArguments: '', ...options });

const introduced = (
  kind: ManagedObjectKind,
  schema: string,
  name: string,
  journal: MigrationJournal,
  introducedAt: number,
): ManagedObject => managed(kind, schema, name, { journal, introducedAt });

/**
 * Seule source de vérité des objets dont le migrateur Snack Manager assume la
 * propriété. Toute réparation itère cette liste : elle ne découvre jamais une
 * cible à muter depuis les catalogues PostgreSQL.
 *
 * `public` est volontairement absent des schémas possédés. Il reste un schéma
 * partagé sur lequel le migrateur reçoit uniquement USAGE + CREATE.
 *
 * Les index, contraintes, triggers et policies RLS sont liés à une table et
 * n'ont pas de propriétaire autonome réparable. Leur dérive (définition des
 * fonctions incluse) n'est pas couverte par ce bootstrap et exige un contrôle
 * d'intégrité live séparé ; le journal de migrations ne suffit pas à la prouver.
 * Les migrations actuelles ne nomment aucune collation ; si elles introduisent
 * un `COLLATE` non qualifié, son inventaire devra rejoindre ce préflight.
 */
export const POSTGRES_MANAGED_OBJECTS: readonly ManagedObject[] = [
  managed('schema', 'drizzle', 'drizzle'),
  introduced(
    'schema',
    'loyalty',
    'loyalty',
    'loyalty',
    LOYALTY_INITIAL_MIGRATION,
  ),

  ...[
    'ingredient_brands',
    'ingredients',
    'invoices',
    'option_ingredients',
    'purchase_order_lines',
    'purchase_orders',
    'recipe_lines',
    'recipes',
    'stock_movements',
    'supplier_items',
    'supplier_price_history',
    'suppliers',
  ].map((name) =>
    introduced('table', 'public', name, 'supply', SUPPLY_INITIAL_MIGRATION),
  ),

  ...[
    'consent_events',
    'consent_state',
    'ledger_entries',
    'member_profiles',
    'member_tokens',
    'members',
    'membership_events',
    'operations',
    'program_versions',
    'programs',
    'redemptions',
    'rewards',
    'wallets',
  ].map((name) =>
    introduced('table', 'loyalty', name, 'loyalty', LOYALTY_INITIAL_MIGRATION),
  ),
  introduced(
    'table',
    'loyalty',
    'earn_receipts',
    'loyalty',
    LOYALTY_EARN_RECEIPTS_MIGRATION,
  ),

  managed('table', 'drizzle', '__drizzle_migrations'),
  managed('table', 'drizzle', '__drizzle_loyalty_migrations'),
  managed('table', 'drizzle', '__drizzle_customer_migrations'),
  managed('sequence', 'drizzle', '__drizzle_migrations_id_seq'),
  managed('sequence', 'drizzle', '__drizzle_loyalty_migrations_id_seq'),
  managed('sequence', 'drizzle', '__drizzle_customer_migrations_id_seq'),

  ...[
    'allergen',
    'base_unit',
    'ingredient_category',
    'invoice_status',
    'measure_unit',
    'movement_type',
    'po_status',
    'storage',
  ].map((name) =>
    introduced('type', 'public', name, 'supply', SUPPLY_INITIAL_MIGRATION),
  ),

  ...[
    'consent_decision',
    'consent_purpose',
    'ledger_kind',
    'ledger_source',
    'mechanism',
    'member_status',
    'membership_event_kind',
    'operation_kind',
    'operation_status',
    'program_status',
    'redemption_status',
    'reward_kind',
    'token_status',
  ].map((name) =>
    introduced('type', 'loyalty', name, 'loyalty', LOYALTY_INITIAL_MIGRATION),
  ),

  {
    ...introduced(
      'function',
      'loyalty',
      'reject_immutable_event',
      'loyalty',
      LOYALTY_INITIAL_MIGRATION,
    ),
    identityArguments: '',
  },
  {
    ...introduced(
      'function',
      'loyalty',
      'validate_ledger_append',
      'loyalty',
      LOYALTY_INITIAL_MIGRATION,
    ),
    identityArguments: '',
  },
  introduced('schema', 'customer', 'customer', 'customer', CUSTOMER_INITIAL_MIGRATION),
  ...[
    'parent_budgets',
    'phone_guards',
    'reservations',
    'accounts',
    'verified_contacts',
    'challenges',
    'provider_verifications',
    'check_attempts',
    'sessions',
  ].map((name) => introduced('table', 'customer', name, 'customer', CUSTOMER_INITIAL_MIGRATION)),
  ...['reject_immutable_record', 'preserve_parent_budget'].map((name) =>
    introduced('function', 'customer', name, 'customer', CUSTOMER_INITIAL_MIGRATION),
  ),
  introduced('table', 'customer', 'paid_budgets', 'customer', CUSTOMER_PAID_BUDGET_MIGRATION),
  ...['seal_paid_parent', 'preserve_paid_budget', 'guard_verification_funding'].map((name) =>
    introduced('function', 'customer', name, 'customer', CUSTOMER_PAID_BUDGET_MIGRATION),
  ),
  introduced('table', 'customer', 'browser_contexts', 'customer', CUSTOMER_BROWSER_CONTINUITY_MIGRATION),
  introduced('function', 'customer', 'preserve_browser_context', 'customer', CUSTOMER_BROWSER_CONTINUITY_MIGRATION),
  introduced('table', 'customer', 'browser_preparations', 'customer', CUSTOMER_BROWSER_PREPARATION_MIGRATION),
  introduced('function', 'customer', 'preserve_browser_preparation', 'customer', CUSTOMER_BROWSER_PREPARATION_MIGRATION),
  introduced('table', 'customer', 'verification_intents', 'customer', CUSTOMER_VERIFICATION_INTENTS_MIGRATION),
  introduced('function', 'customer', 'preserve_verification_intent', 'customer', CUSTOMER_VERIFICATION_INTENTS_MIGRATION),
] as const;

export const JOURNALS: Readonly<
  Record<MigrationJournal, { table: string; sequence: string; columns: readonly string[] }>
> = {
  supply: {
    table: '__drizzle_migrations',
    sequence: '__drizzle_migrations_id_seq',
    columns: ['id', 'hash', 'created_at'],
  },
  loyalty: {
    table: '__drizzle_loyalty_migrations',
    sequence: '__drizzle_loyalty_migrations_id_seq',
    columns: ['id', 'hash', 'created_at'],
  },
  customer: {
    table: '__drizzle_customer_migrations',
    sequence: '__drizzle_customer_migrations_id_seq',
    columns: ['id', 'hash', 'created_at'],
  },
};

export function managedObjectKey(
  object: Pick<ManagedObject, 'kind' | 'schema' | 'name' | 'identityArguments'>,
): string {
  const signature = object.kind === 'function' ? `(${object.identityArguments})` : '';
  return `${object.kind}:${object.schema}.${object.name}${signature}`;
}
