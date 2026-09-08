CREATE TABLE "customer"."verification_intents" (
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  operation_id uuid NOT NULL,
  browser_ref uuid NOT NULL,
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  proof_hash text CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  browser_generation bigint NOT NULL CHECK (browser_generation BETWEEN 0 AND 9007199254740991),
  state text NOT NULL CHECK (state IN ('open','closed','consumed')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (parent_ref,tenant_ref,operation_id),
  UNIQUE (parent_ref,tenant_ref,proof_hash),
  UNIQUE (parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation),
  FOREIGN KEY (parent_ref,tenant_ref,browser_ref,browser_hash)
    REFERENCES customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CHECK (state='closed' OR proof_hash IS NOT NULL),
  CHECK ((state='closed')=(closed_at IS NOT NULL)),
  CHECK (state<>'consumed' OR consumed_at IS NOT NULL),
  CHECK (closed_at IS NULL OR closed_at>=created_at),
  CHECK (consumed_at IS NULL OR consumed_at>=created_at)
);
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_verification_intent"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Verification intention is immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.operation_id,NEW.browser_ref,NEW.browser_hash,NEW.proof_hash,NEW.browser_generation,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.operation_id,OLD.browser_ref,OLD.browser_hash,OLD.proof_hash,OLD.browser_generation,OLD.created_at,OLD.expires_at)
    OR (OLD.state='closed' AND NEW IS DISTINCT FROM OLD)
    OR (OLD.state='consumed' AND NEW.state NOT IN ('consumed','closed'))
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
    OR (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND clock_timestamp()>=OLD.expires_at) THEN
    RAISE EXCEPTION 'Verification intention is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER verification_intent_immutable BEFORE UPDATE OR DELETE ON customer.verification_intents
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_verification_intent();
--> statement-breakpoint
CREATE TRIGGER verification_intent_no_truncate BEFORE TRUNCATE ON customer.verification_intents
  FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_verification_intent();
--> statement-breakpoint
ALTER TABLE customer.verification_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.verification_intents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer.verification_intents
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
--> statement-breakpoint
-- Legacy requests have no authority inferred from their public IDs.
ALTER TABLE customer.challenges ADD COLUMN intent_operation_id uuid,
  ADD CONSTRAINT challenge_intent_id_matches CHECK (intent_operation_id IS NULL OR intent_operation_id=operation_id),
  ADD CONSTRAINT challenge_intent_fk FOREIGN KEY (parent_ref,tenant_ref,intent_operation_id,browser_ref,browser_hash,browser_generation)
    REFERENCES customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation);
--> statement-breakpoint
ALTER TABLE customer.check_attempts ADD COLUMN request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE TRIGGER check_request_immutable BEFORE UPDATE OF request_hash ON customer.check_attempts
  FOR EACH ROW EXECUTE FUNCTION customer.reject_immutable_record();
--> statement-breakpoint
CREATE TRIGGER check_receipt_no_delete BEFORE DELETE ON customer.check_attempts
  FOR EACH ROW WHEN (OLD.request_hash IS NOT NULL) EXECUTE FUNCTION customer.reject_immutable_record();
--> statement-breakpoint
CREATE TRIGGER check_receipt_no_truncate BEFORE TRUNCATE ON customer.check_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION customer.reject_immutable_record();
