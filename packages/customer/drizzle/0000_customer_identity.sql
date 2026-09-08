CREATE SCHEMA "customer";
--> statement-breakpoint
CREATE TABLE "customer"."parent_budgets" (
  parent_ref text PRIMARY KEY CHECK (length(parent_ref) BETWEEN 1 AND 160),
  send_limit bigint NOT NULL CHECK (send_limit BETWEEN 1 AND 50),
  sms_limit bigint NOT NULL CHECK (sms_limit BETWEEN 1 AND 9007199254740991),
  verification_limit bigint NOT NULL CHECK (verification_limit BETWEEN 1 AND 9007199254740991),
  reserved_sends bigint NOT NULL DEFAULT 0 CHECK (reserved_sends BETWEEN 0 AND 9007199254740991),
  reserved_sms bigint NOT NULL DEFAULT 0 CHECK (reserved_sms BETWEEN 0 AND 9007199254740991),
  reserved_verifications bigint NOT NULL DEFAULT 0 CHECK (reserved_verifications BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE "customer"."phone_guards" (
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  global_phone_hash text NOT NULL CHECK (global_phone_hash ~ '^[a-f0-9]{64}$'),
  active_until timestamptz NOT NULL,
  PRIMARY KEY (parent_ref, global_phone_hash)
);
--> statement-breakpoint
CREATE TABLE "customer"."accounts" (
  id uuid PRIMARY KEY,
  tenant_ref text NOT NULL CHECK (length(tenant_ref) BETWEEN 1 AND 160),
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  session_version bigint NOT NULL DEFAULT 0 CHECK (session_version BETWEEN 0 AND 9007199254740991),
  encrypted_name text CHECK (encrypted_name IS NULL OR length(encrypted_name) BETWEEN 1 AND 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (parent_ref, tenant_ref, id)
);
--> statement-breakpoint
CREATE TABLE "customer"."verified_contacts" (
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  account_id uuid NOT NULL,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  encrypted_phone text NOT NULL CHECK (length(encrypted_phone) BETWEEN 1 AND 4096),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (parent_ref, tenant_ref, account_id),
  UNIQUE (tenant_ref, phone_hash),
  FOREIGN KEY (parent_ref, tenant_ref, account_id) REFERENCES customer.accounts(parent_ref, tenant_ref, id)
);
--> statement-breakpoint
CREATE TABLE "customer"."challenges" (
  id uuid PRIMARY KEY,
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL CHECK (length(tenant_ref) BETWEEN 1 AND 160),
  operation_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[a-f0-9]{64}$'),
  encrypted_phone text NOT NULL CHECK (length(encrypted_phone) BETWEEN 1 AND 4096),
  service_sid text NOT NULL CHECK (service_sid ~ '^VA[0-9a-fA-F]{32}$'),
  verification_sid text CHECK (verification_sid IS NULL OR verification_sid ~ '^VE[0-9a-fA-F]{32}$'),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','pending','checking','consumed','uncertain','expired','locked','rejected')),
  max_checks integer NOT NULL CHECK (max_checks BETWEEN 1 AND 5),
  checks_used integer NOT NULL DEFAULT 0 CHECK (checks_used BETWEEN 0 AND max_checks),
  check_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  UNIQUE (parent_ref, tenant_ref, id),
  UNIQUE (tenant_ref, operation_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CHECK (state NOT IN ('pending','checking','consumed') OR verification_sid IS NOT NULL),
  CHECK (state NOT IN ('checking','consumed') OR check_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "customer"."reservations" (
  id uuid PRIMARY KEY,
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL,
  challenge_id uuid NOT NULL,
  global_phone_hash text NOT NULL CHECK (global_phone_hash ~ '^[a-f0-9]{64}$'),
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[a-f0-9]{64}$'),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 120),
  sms_units integer NOT NULL CHECK (sms_units BETWEEN 1 AND 10),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (parent_ref, tenant_ref, challenge_id) REFERENCES customer.challenges(parent_ref, tenant_ref, id),
  UNIQUE (parent_ref, challenge_id)
);
--> statement-breakpoint
CREATE INDEX reservations_parent_time_idx ON customer.reservations(parent_ref, reserved_at);
--> statement-breakpoint
CREATE INDEX reservations_parent_phone_time_idx ON customer.reservations(parent_ref, global_phone_hash, reserved_at);
--> statement-breakpoint
CREATE TABLE "customer"."provider_verifications" (
  parent_ref text NOT NULL,
  service_sid text NOT NULL CHECK (service_sid ~ '^VA[0-9a-fA-F]{32}$'),
  verification_sid text NOT NULL CHECK (verification_sid ~ '^VE[0-9a-fA-F]{32}$'),
  tenant_ref text NOT NULL,
  challenge_id uuid NOT NULL,
  PRIMARY KEY (parent_ref, service_sid, verification_sid),
  FOREIGN KEY (parent_ref, tenant_ref, challenge_id) REFERENCES customer.challenges(parent_ref, tenant_ref, id)
);
--> statement-breakpoint
CREATE INDEX provider_verifications_challenge_idx ON customer.provider_verifications(parent_ref, tenant_ref, challenge_id);
--> statement-breakpoint
CREATE TABLE "customer"."check_attempts" (
  id uuid PRIMARY KEY,
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  challenge_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'checking' CHECK (state IN ('checking','approved','pending','expired','locked','uncertain','rejected')),
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  FOREIGN KEY (parent_ref, tenant_ref, challenge_id) REFERENCES customer.challenges(parent_ref, tenant_ref, id),
  UNIQUE (parent_ref, tenant_ref, id),
  CHECK ((state = 'checking' AND completed_at IS NULL) OR (state <> 'checking' AND completed_at IS NOT NULL)),
  CHECK (state <> 'approved' OR session_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX check_attempts_challenge_idx ON customer.check_attempts(parent_ref, tenant_ref, challenge_id);
--> statement-breakpoint
CREATE TABLE "customer"."sessions" (
  id uuid PRIMARY KEY,
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  account_id uuid NOT NULL,
  session_hash text NOT NULL UNIQUE CHECK (session_hash ~ '^[a-f0-9]{64}$'),
  account_version bigint NOT NULL CHECK (account_version BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (parent_ref, tenant_ref, id),
  FOREIGN KEY (parent_ref, tenant_ref, account_id) REFERENCES customer.accounts(parent_ref, tenant_ref, id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX sessions_account_idx ON customer.sessions(parent_ref, tenant_ref, account_id);
--> statement-breakpoint
ALTER TABLE customer.check_attempts ADD CONSTRAINT check_attempt_session_fk
  FOREIGN KEY (parent_ref, tenant_ref, session_id) REFERENCES customer.sessions(parent_ref, tenant_ref, id);
--> statement-breakpoint
CREATE FUNCTION "customer"."reject_immutable_record"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer identity proof is immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reservations_immutable BEFORE UPDATE OR DELETE ON customer.reservations
  FOR EACH ROW EXECUTE FUNCTION customer.reject_immutable_record();
--> statement-breakpoint
CREATE TRIGGER provider_verifications_immutable BEFORE UPDATE OR DELETE ON customer.provider_verifications
  FOR EACH ROW EXECUTE FUNCTION customer.reject_immutable_record();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_parent_budget"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Customer budget cannot be reset' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_ref <> OLD.parent_ref OR NEW.created_at <> OLD.created_at
    OR NEW.reserved_sends < OLD.reserved_sends OR NEW.reserved_sms < OLD.reserved_sms
    OR NEW.reserved_verifications < OLD.reserved_verifications
    OR NEW.send_limit > OLD.send_limit OR NEW.sms_limit > OLD.sms_limit
    OR NEW.verification_limit > OLD.verification_limit THEN
    RAISE EXCEPTION 'Customer budget cannot be reset' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER parent_budgets_monotonic BEFORE UPDATE OR DELETE ON customer.parent_budgets
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_parent_budget();
--> statement-breakpoint
ALTER TABLE customer.parent_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.parent_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.parent_budgets USING (parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.phone_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.phone_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.phone_guards USING (parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.reservations USING (parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.provider_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.provider_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.provider_verifications USING (parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.accounts USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.verified_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.verified_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.verified_contacts USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.challenges USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.check_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.check_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.check_attempts USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
--> statement-breakpoint
ALTER TABLE customer.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.sessions USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true)) WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
