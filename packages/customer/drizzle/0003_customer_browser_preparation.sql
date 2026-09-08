-- Preparation is deliberately independent of SMS reservations and parent budgets.
CREATE TABLE "customer"."browser_preparations" (
  parent_ref text NOT NULL CHECK (length(parent_ref) BETWEEN 1 AND 160),
  tenant_ref text NOT NULL CHECK (length(tenant_ref) BETWEEN 1 AND 160),
  browser_ref uuid NOT NULL,
  browser_hash text CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  admission_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  issued_at timestamptz,
  confirmed_at timestamptz,
  PRIMARY KEY (parent_ref,tenant_ref,browser_ref),
  UNIQUE (parent_ref,tenant_ref,browser_hash),
  UNIQUE (parent_ref,tenant_ref,browser_ref,browser_hash),
  CHECK (admission_expires_at = created_at + interval '10 minutes'),
  CHECK (expires_at = created_at + interval '168 hours'),
  CHECK ((browser_hash IS NULL) = (issued_at IS NULL)),
  CHECK (issued_at IS NULL OR (issued_at >= created_at AND issued_at < admission_expires_at)),
  CHECK (confirmed_at IS NULL OR (issued_at IS NOT NULL AND confirmed_at >= issued_at AND confirmed_at < admission_expires_at))
);
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_browser_preparation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'Browser preparation is immutable' USING ERRCODE = '23514';
  END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.browser_ref,NEW.created_at,NEW.admission_expires_at,NEW.expires_at)
      IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.browser_ref,OLD.created_at,OLD.admission_expires_at,OLD.expires_at)
    OR (OLD.browser_hash IS NOT NULL AND (NEW.browser_hash,NEW.issued_at) IS DISTINCT FROM (OLD.browser_hash,OLD.issued_at))
    OR (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at)
    OR (OLD.browser_hash IS NULL AND NEW.browser_hash IS NOT NULL AND clock_timestamp() >= OLD.admission_expires_at)
    OR (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL AND clock_timestamp() >= OLD.admission_expires_at) THEN
    RAISE EXCEPTION 'Browser preparation is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER browser_preparation_immutable BEFORE UPDATE OR DELETE ON customer.browser_preparations
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_browser_preparation();
--> statement-breakpoint
CREATE TRIGGER browser_preparation_no_truncate BEFORE TRUNCATE ON customer.browser_preparations
  FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_browser_preparation();
--> statement-breakpoint
ALTER TABLE customer.browser_preparations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_preparations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer.browser_preparations
  USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true))
  WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
-- NULL on existing data means no inferred browser preparation or legacy fallback.
ALTER TABLE customer.challenges ADD COLUMN browser_ref uuid,
  ADD CONSTRAINT challenges_browser_preparation_fk FOREIGN KEY (parent_ref,tenant_ref,browser_ref,browser_hash)
    REFERENCES customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash);
--> statement-breakpoint
ALTER TABLE customer.sessions ADD COLUMN browser_ref uuid,
  ADD CONSTRAINT sessions_browser_preparation_fk FOREIGN KEY (parent_ref,tenant_ref,browser_ref,browser_hash)
    REFERENCES customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash);
