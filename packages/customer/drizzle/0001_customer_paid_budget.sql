-- Additive only. Roll back application code, NEVER delete financial evidence.
ALTER TABLE customer.parent_budgets DROP CONSTRAINT parent_budgets_sms_limit_check;
ALTER TABLE customer.parent_budgets ADD CONSTRAINT parent_budgets_sms_limit_check CHECK (sms_limit BETWEEN 0 AND 9007199254740991);
ALTER TABLE customer.parent_budgets DROP CONSTRAINT parent_budgets_verification_limit_check;
ALTER TABLE customer.parent_budgets ADD CONSTRAINT parent_budgets_verification_limit_check CHECK (verification_limit BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
CREATE TABLE "customer"."paid_budgets" (
  parent_ref text PRIMARY KEY REFERENCES customer.parent_budgets(parent_ref),
  authorization_ref text NOT NULL CHECK (authorization_ref ~ '^[a-zA-Z0-9_-]{1,120}$'),
  currency text NOT NULL CHECK (currency = 'USD'),
  authorized_spend_microusd bigint NOT NULL CHECK (authorized_spend_microusd BETWEEN 0 AND 9007199254740991),
  reserved_spend_microusd bigint NOT NULL DEFAULT 0 CHECK (reserved_spend_microusd BETWEEN 0 AND 9007199254740991),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (parent_ref, authorization_ref)
);
--> statement-breakpoint
CREATE FUNCTION "customer"."seal_paid_parent"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reserved_spend_microusd > NEW.authorized_spend_microusd THEN
    RAISE EXCEPTION 'Customer paid budget exceeded' USING ERRCODE = '23514';
  END IF;
  -- Same lock as the legacy Trial writer, including a pre-existing parent.
  UPDATE customer.parent_budgets SET sms_limit=0, verification_limit=0 WHERE parent_ref=NEW.parent_ref;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paid_parent_sealed BEFORE INSERT ON customer.paid_budgets
  FOR EACH ROW EXECUTE FUNCTION customer.seal_paid_parent();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_paid_budget"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Customer paid budget cannot be reset' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_ref IS DISTINCT FROM OLD.parent_ref
    OR NEW.authorization_ref IS DISTINCT FROM OLD.authorization_ref
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.reserved_spend_microusd < OLD.reserved_spend_microusd
    OR (NEW.reserved_spend_microusd > OLD.reserved_spend_microusd
      AND NEW.reserved_spend_microusd > NEW.authorized_spend_microusd)
    OR NEW.authorized_spend_microusd > OLD.authorized_spend_microusd
    OR NEW.expires_at > OLD.expires_at THEN
    RAISE EXCEPTION 'Customer paid budget cannot be reset' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paid_budgets_monotonic BEFORE UPDATE OR DELETE ON customer.paid_budgets
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_paid_budget();
--> statement-breakpoint
ALTER TABLE customer.paid_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.paid_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.paid_budgets
  USING (parent_ref = current_setting('app.customer_parent_ref', true))
  WITH CHECK (parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.reservations
  ADD COLUMN funding_kind text NOT NULL DEFAULT 'trial',
  ADD COLUMN authorization_ref text,
  ADD COLUMN reserved_microusd bigint NOT NULL DEFAULT 0,
  ADD COLUMN funding_expires_at timestamptz,
  ADD COLUMN cost_evidence_reference text,
  ADD CONSTRAINT reservation_paid_authorization_fk FOREIGN KEY (parent_ref, authorization_ref)
    REFERENCES customer.paid_budgets(parent_ref, authorization_ref),
  ADD CONSTRAINT reservation_funding CHECK (
    (funding_kind = 'trial' AND authorization_ref IS NULL AND reserved_microusd = 0 AND funding_expires_at IS NULL AND cost_evidence_reference IS NULL)
    OR (funding_kind = 'paid' AND authorization_ref IS NOT NULL
      AND reserved_microusd BETWEEN 1 AND 9007199254740991
      AND cost_evidence_reference IS NOT NULL AND cost_evidence_reference ~ '^[a-zA-Z0-9_-]{1,120}$'
      AND funding_expires_at IS NOT NULL AND isfinite(funding_expires_at))
  );
--> statement-breakpoint
CREATE FUNCTION "customer"."guard_verification_funding"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  proof record;
BEGIN
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  SELECT r.funding_kind,r.authorization_ref,r.funding_expires_at,
    p.parent_ref AS paid_parent,p.authorization_ref AS paid_authorization,p.expires_at AS paid_expiry
    INTO proof FROM customer.reservations r LEFT JOIN customer.paid_budgets p ON p.parent_ref=r.parent_ref
    WHERE r.parent_ref=NEW.parent_ref AND r.tenant_ref=NEW.tenant_ref AND r.challenge_id=NEW.challenge_id;
  -- Also fences the pre-Paid binary's INSERT, which never read funding metadata.
  IF NOT FOUND OR (proof.funding_kind='trial' AND proof.paid_parent IS NOT NULL)
    OR (proof.funding_kind='paid' AND (proof.paid_parent IS NULL
      OR proof.authorization_ref IS DISTINCT FROM proof.paid_authorization
      OR LEAST(proof.funding_expires_at,proof.paid_expiry)<=clock_timestamp())) THEN
    RAISE EXCEPTION 'Customer verification funding unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER verification_funding_guard BEFORE INSERT ON customer.check_attempts
  FOR EACH ROW EXECUTE FUNCTION customer.guard_verification_funding();
