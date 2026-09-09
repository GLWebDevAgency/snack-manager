-- A protected customer account is the durable owner of this association.
-- This is not a phone lookup, a browser session or a recoverable POS handoff.
-- No historical loyalty card is linked or adopted by this additive migration.
CREATE TABLE "customer"."loyalty_memberships" (
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  account_id uuid NOT NULL,
  member_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (parent_ref, tenant_ref, account_id),
  CONSTRAINT loyalty_memberships_tenant_member_uq UNIQUE (tenant_ref, member_id),
  CONSTRAINT loyalty_memberships_tenant_operation_uq UNIQUE (tenant_ref, operation_id),
  CONSTRAINT loyalty_memberships_account_fk FOREIGN KEY (parent_ref, tenant_ref, account_id)
    REFERENCES customer.accounts(parent_ref, tenant_ref, id) ON DELETE RESTRICT,
  CONSTRAINT loyalty_memberships_member_fk FOREIGN KEY (tenant_ref, member_id)
    REFERENCES loyalty.members(tenant_ref, id) ON DELETE RESTRICT,
  CONSTRAINT loyalty_memberships_operation_fk FOREIGN KEY (tenant_ref, operation_id)
    REFERENCES loyalty.operations(tenant_ref, operation_id) ON DELETE RESTRICT
);
--> statement-breakpoint
-- Preserve ownership even if a member is subsequently blocked/anonymized or an
-- account is deactivated. A new phone holder must not acquire this association.
CREATE TRIGGER loyalty_memberships_immutable BEFORE UPDATE OR DELETE ON customer.loyalty_memberships
  FOR EACH ROW EXECUTE FUNCTION customer.reject_immutable_record();
--> statement-breakpoint
ALTER TABLE customer.loyalty_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.loyalty_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.loyalty_memberships
  USING (tenant_ref = current_setting('app.tenant_ref', true)
    AND parent_ref = current_setting('app.customer_parent_ref', true))
  WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true)
    AND parent_ref = current_setting('app.customer_parent_ref', true));
