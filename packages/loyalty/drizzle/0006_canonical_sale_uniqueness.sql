-- Additive protection: no historical reference, receipt, wallet or ledger is
-- rewritten. The original exact-reference indexes remain in force.
-- Drizzle executes this entire migration in its transaction. A bounded lock
-- wait fails closed instead of blocking operational writes indefinitely.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
  -- A global SELECT preflight would be blind for the non-BYPASSRLS migration
  -- owner because both tables FORCE RLS. CREATE UNIQUE INDEX checks every row,
  -- including tenants not visible to that owner, and atomically refuses drift.
  CREATE UNIQUE INDEX "earn_receipts_tenant_canonical_sale_uq"
    ON "loyalty"."earn_receipts" USING btree ("tenant_ref", lower(split_part("external_ref", ':', 2)))
    WHERE "source" IN ('pos', 'online')
      AND "external_ref" ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  CREATE UNIQUE INDEX "ledger_earn_canonical_sale_uq"
    ON "loyalty"."ledger_entries" USING btree ("tenant_ref", lower(split_part("external_ref", ':', 2)))
    WHERE "kind" = 'earn' AND "source" IN ('pos', 'online')
      AND "external_ref" ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
EXCEPTION WHEN unique_violation THEN
  -- Replace PostgreSQL's duplicate-key detail: deployment output must not
  -- disclose a tenant or sale identity. Neither index nor journal is committed.
  RAISE EXCEPTION USING ERRCODE = '23505',
    MESSAGE = 'Canonical loyalty sale collision; migration rolled back';
END;
$$;

-- Recovery: investigate collisions through an authorized tenant-scoped audit.
-- Never deduplicate/delete financial history automatically. The previous code
-- remains compatible after success; do not drop this protection on app rollback.
