-- Closed-pilot migration: stop 0005 writers before reopening. Old rows retain
-- their authority; no historical phone identity is inferred to be protected.
ALTER TABLE customer.check_attempts DROP CONSTRAINT check_attempts_state_check;
--> statement-breakpoint
ALTER TABLE customer.check_attempts ADD CONSTRAINT check_attempts_state_check
  CHECK (state IN ('checking','approved','verified','pending','expired','locked','uncertain','rejected'));
--> statement-breakpoint
ALTER TABLE customer.check_attempts ADD CONSTRAINT check_enrollment_binding_unique UNIQUE(parent_ref,tenant_ref,id,challenge_id);
--> statement-breakpoint
CREATE TABLE "customer"."registration_enrollments" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, id uuid NOT NULL,
  operation_id uuid NOT NULL, challenge_id uuid NOT NULL,
  browser_ref uuid NOT NULL, browser_hash text NOT NULL, browser_generation bigint NOT NULL,
  phone_hash text NOT NULL CHECK(phone_hash ~ '^[a-f0-9]{64}$'), encrypted_phone text NOT NULL CHECK(length(encrypted_phone) BETWEEN 1 AND 4096),
  verified_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  registration_id uuid, origin text, rp_id text, registration_challenge text, user_handle text,
  registration_request_hash text CHECK(registration_request_hash ~ '^[a-f0-9]{64}$'), credential jsonb,
  registration_counter bigint CHECK(registration_counter BETWEEN 0 AND 4294967295),
  assertion_id uuid, assertion_challenge text,
  assertion_request_hash text CHECK(assertion_request_hash ~ '^[a-f0-9]{64}$'), asserted_at timestamptz,
  recovery_receipts jsonb NOT NULL DEFAULT '[]', activation_attempts jsonb NOT NULL DEFAULT '[]',
  activation_intent_id uuid, failed_confirmations integer NOT NULL DEFAULT 0 CHECK(failed_confirmations BETWEEN 0 AND 5),
  activation_id uuid, activated_at timestamptz, session_id uuid,
  PRIMARY KEY(parent_ref,tenant_ref,id), UNIQUE(parent_ref,tenant_ref,operation_id),
  UNIQUE(parent_ref,tenant_ref,id,challenge_id),
  FOREIGN KEY(parent_ref,tenant_ref,id,challenge_id) REFERENCES customer.check_attempts(parent_ref,tenant_ref,id,challenge_id),
  FOREIGN KEY(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation)
    REFERENCES customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation),
  FOREIGN KEY(parent_ref,tenant_ref,session_id) REFERENCES customer.sessions(parent_ref,tenant_ref,id),
  CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '10 minutes'),
  CHECK(num_nonnulls(registration_id,origin,rp_id,registration_challenge,user_handle) IN (0,5)),
  CHECK((registration_id IS NULL AND origin IS NULL AND rp_id IS NULL AND registration_challenge IS NULL AND user_handle IS NULL)
    OR (registration_id IS NOT NULL AND length(origin) BETWEEN 1 AND 2048 AND length(rp_id) BETWEEN 1 AND 253
      AND registration_challenge ~ '^[A-Za-z0-9_-]{43}$' AND user_handle ~ '^[A-Za-z0-9_-]{43}$')),
  CHECK((registration_request_hash IS NULL)=(credential IS NULL)),
  CHECK((registration_counter IS NULL)=(credential IS NULL)),
  CHECK(credential IS NULL OR (registration_id IS NOT NULL AND jsonb_typeof(credential)='object' AND octet_length(credential::text)<=16384)),
  CHECK((assertion_id IS NULL)=(assertion_challenge IS NULL)),
  CHECK(assertion_challenge IS NULL OR (credential IS NOT NULL AND assertion_challenge ~ '^[A-Za-z0-9_-]{43}$')),
  CHECK((assertion_request_hash IS NULL)=(asserted_at IS NULL)),
  CHECK(asserted_at IS NULL OR (assertion_id IS NOT NULL AND asserted_at>=verified_at AND asserted_at<expires_at)),
  CHECK(jsonb_typeof(recovery_receipts)='array' AND jsonb_array_length(recovery_receipts)<=3),
  CHECK(jsonb_typeof(activation_attempts)='array' AND jsonb_array_length(activation_attempts)<=1),
  CHECK(jsonb_array_length(recovery_receipts)=0 OR asserted_at IS NOT NULL),
  CHECK((activation_id IS NULL)=(activated_at IS NULL) AND (activation_id IS NULL)=(session_id IS NULL)),
  CHECK(activation_id IS NULL OR (activation_intent_id IS NOT NULL AND activation_id=activation_intent_id)),
  CHECK(activated_at IS NULL OR (asserted_at IS NOT NULL AND jsonb_array_length(recovery_receipts)>0 AND activated_at<expires_at))
);
--> statement-breakpoint
ALTER TABLE customer.check_attempts ADD COLUMN enrollment_id uuid,
  ADD CONSTRAINT check_enrollment_fk FOREIGN KEY(parent_ref,tenant_ref,enrollment_id,challenge_id)
    REFERENCES customer.registration_enrollments(parent_ref,tenant_ref,id,challenge_id),
  ADD CONSTRAINT check_verified_enrollment CHECK
    ((state<>'verified' OR (enrollment_id IS NOT NULL AND enrollment_id=id AND session_id IS NULL AND request_hash IS NOT NULL)) AND (enrollment_id IS NULL OR state='verified'));
--> statement-breakpoint
ALTER TABLE customer.accounts ADD COLUMN enrollment_id uuid,
  ADD CONSTRAINT account_enrollment_fk FOREIGN KEY(parent_ref,tenant_ref,enrollment_id)
    REFERENCES customer.registration_enrollments(parent_ref,tenant_ref,id),
  ADD CONSTRAINT account_enrollment_unique UNIQUE(parent_ref,tenant_ref,enrollment_id);
--> statement-breakpoint
CREATE TABLE "customer"."passkey_credentials" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, account_id uuid NOT NULL,
  rp_id text NOT NULL CHECK(length(rp_id) BETWEEN 1 AND 253), credential_id text NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 2048),
  public_key bytea NOT NULL CHECK(octet_length(public_key) BETWEEN 1 AND 4096), user_handle text NOT NULL CHECK(user_handle ~ '^[A-Za-z0-9_-]{43}$'),
  counter bigint NOT NULL CHECK(counter BETWEEN 0 AND 4294967295), device_type text NOT NULL CHECK(device_type IN ('singleDevice','multiDevice')),
  backed_up boolean NOT NULL, transports jsonb NOT NULL CHECK(jsonb_typeof(transports)='array' AND jsonb_array_length(transports)<=7),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
  PRIMARY KEY(tenant_ref,rp_id,credential_id), UNIQUE(parent_ref,tenant_ref,account_id),
  FOREIGN KEY(parent_ref,tenant_ref,account_id) REFERENCES customer.accounts(parent_ref,tenant_ref,id),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
--> statement-breakpoint
CREATE TABLE "customer"."recovery_codes" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, account_id uuid NOT NULL,
  version bigint NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991), code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(), consumed_at timestamptz, revoked_at timestamptz,
  PRIMARY KEY(parent_ref,tenant_ref,account_id,version), UNIQUE(parent_ref,tenant_ref,code_hash),
  FOREIGN KEY(parent_ref,tenant_ref,account_id) REFERENCES customer.accounts(parent_ref,tenant_ref,id),
  CHECK(consumed_at IS NULL OR consumed_at>=confirmed_at), CHECK(revoked_at IS NULL OR revoked_at>=confirmed_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_code_active_idx ON customer.recovery_codes(parent_ref,tenant_ref,account_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_registration_enrollment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE idx integer;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Enrollment proof is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.id,NEW.operation_id,NEW.challenge_id,NEW.browser_ref,NEW.browser_hash,NEW.browser_generation,
      NEW.phone_hash,NEW.encrypted_phone,NEW.verified_at,NEW.expires_at)
      IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.id,OLD.operation_id,OLD.challenge_id,OLD.browser_ref,OLD.browser_hash,OLD.browser_generation,
      OLD.phone_hash,OLD.encrypted_phone,OLD.verified_at,OLD.expires_at)
    OR (OLD.activated_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
    OR (OLD.registration_id IS NOT NULL AND (NEW.registration_id,NEW.origin,NEW.rp_id,NEW.registration_challenge,NEW.user_handle)
       IS DISTINCT FROM (OLD.registration_id,OLD.origin,OLD.rp_id,OLD.registration_challenge,OLD.user_handle))
    OR (OLD.registration_request_hash IS NOT NULL AND NEW.registration_request_hash IS DISTINCT FROM OLD.registration_request_hash)
    OR (OLD.registration_counter IS NOT NULL AND NEW.registration_counter IS DISTINCT FROM OLD.registration_counter)
    OR (OLD.credential IS NOT NULL AND (NEW.credential IS NULL
      OR (NEW.credential-'counter'-'backedUp') IS DISTINCT FROM (OLD.credential-'counter'-'backedUp')
      OR (NEW.credential->>'counter')::bigint<(OLD.credential->>'counter')::bigint))
    OR (OLD.assertion_id IS NOT NULL AND (NEW.assertion_id,NEW.assertion_challenge) IS DISTINCT FROM (OLD.assertion_id,OLD.assertion_challenge))
    OR (OLD.asserted_at IS NOT NULL AND (NEW.assertion_request_hash,NEW.asserted_at,NEW.credential) IS DISTINCT FROM (OLD.assertion_request_hash,OLD.asserted_at,OLD.credential))
    OR (OLD.activation_intent_id IS NOT NULL AND NEW.activation_intent_id IS DISTINCT FROM OLD.activation_intent_id)
    OR NEW.failed_confirmations<OLD.failed_confirmations
    OR NOT NEW.recovery_receipts @> OLD.recovery_receipts OR NOT NEW.activation_attempts @> OLD.activation_attempts
    OR jsonb_array_length(NEW.recovery_receipts)<jsonb_array_length(OLD.recovery_receipts)
    OR jsonb_array_length(NEW.activation_attempts)<jsonb_array_length(OLD.activation_attempts)
    OR clock_timestamp()>=OLD.expires_at THEN
    RAISE EXCEPTION 'Enrollment proof is immutable' USING ERRCODE='23514';
  END IF;
  FOR idx IN 0..jsonb_array_length(OLD.recovery_receipts)-1 LOOP
    IF NEW.recovery_receipts->idx IS DISTINCT FROM OLD.recovery_receipts->idx THEN
      RAISE EXCEPTION 'Enrollment proof is immutable' USING ERRCODE='23514';
    END IF;
  END LOOP;
  FOR idx IN 0..jsonb_array_length(OLD.activation_attempts)-1 LOOP
    IF NEW.activation_attempts->idx IS DISTINCT FROM OLD.activation_attempts->idx THEN
      RAISE EXCEPTION 'Enrollment proof is immutable' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enrollment_immutable BEFORE UPDATE OR DELETE ON customer.registration_enrollments FOR EACH ROW EXECUTE FUNCTION customer.preserve_registration_enrollment();
--> statement-breakpoint
CREATE TRIGGER enrollment_no_truncate BEFORE TRUNCATE ON customer.registration_enrollments FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_registration_enrollment();
--> statement-breakpoint
CREATE FUNCTION "customer"."guard_account_enrollment"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_WHEN='AFTER' THEN
    IF NOT EXISTS(SELECT 1 FROM customer.registration_enrollments e
      JOIN customer.sessions s ON (s.parent_ref,s.tenant_ref,s.id)=(e.parent_ref,e.tenant_ref,e.session_id)
      JOIN customer.passkey_credentials k ON (k.parent_ref,k.tenant_ref,k.account_id)=(s.parent_ref,s.tenant_ref,s.account_id)
      JOIN customer.recovery_codes r ON (r.parent_ref,r.tenant_ref,r.account_id)=(s.parent_ref,s.tenant_ref,s.account_id)
      JOIN customer.session_publications u ON (u.parent_ref,u.tenant_ref,u.session_id)=(s.parent_ref,s.tenant_ref,s.id)
      WHERE e.parent_ref=NEW.parent_ref AND e.tenant_ref=NEW.tenant_ref AND e.id=NEW.enrollment_id
        AND s.account_id=NEW.id AND e.activated_at IS NOT NULL AND e.asserted_at IS NOT NULL
        AND k.credential_id=e.credential->>'credentialId' AND k.rp_id=e.rp_id
        AND r.code_hash=e.recovery_receipts->-1->>'codeHash' AND r.version=jsonb_array_length(e.recovery_receipts)
        AND u.method='passkey' AND u.operation_id=e.operation_id AND u.check_id=e.activation_id) THEN
      RAISE EXCEPTION 'Atomic protected activation required' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id THEN RAISE EXCEPTION 'Account enrollment is immutable' USING ERRCODE='23514'; END IF;
  ELSIF NEW.enrollment_id IS NULL THEN RAISE EXCEPTION 'Protected enrollment required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_enrollment_required BEFORE INSERT OR UPDATE OF enrollment_id ON customer.accounts FOR EACH ROW EXECUTE FUNCTION customer.guard_account_enrollment();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER account_enrollment_atomic AFTER INSERT ON customer.accounts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION customer.guard_account_enrollment();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_passkey_credential"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Credential proof is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.account_id,NEW.rp_id,NEW.credential_id,NEW.public_key,NEW.user_handle,NEW.device_type,NEW.transports,NEW.created_at)
    IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.account_id,OLD.rp_id,OLD.credential_id,OLD.public_key,OLD.user_handle,OLD.device_type,OLD.transports,OLD.created_at)
    OR NEW.counter<OLD.counter OR (OLD.revoked_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Credential proof is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER passkey_immutable BEFORE UPDATE OR DELETE ON customer.passkey_credentials FOR EACH ROW EXECUTE FUNCTION customer.preserve_passkey_credential();
--> statement-breakpoint
CREATE TRIGGER passkey_no_truncate BEFORE TRUNCATE ON customer.passkey_credentials FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_passkey_credential();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_recovery_code"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Recovery proof is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.account_id,NEW.version,NEW.code_hash,NEW.confirmed_at)
    IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.account_id,OLD.version,OLD.code_hash,OLD.confirmed_at)
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Recovery proof is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_code_immutable BEFORE UPDATE OR DELETE ON customer.recovery_codes FOR EACH ROW EXECUTE FUNCTION customer.preserve_recovery_code();
--> statement-breakpoint
CREATE TRIGGER recovery_code_no_truncate BEFORE TRUNCATE ON customer.recovery_codes FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_recovery_code();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_check_outcome"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state<>'checking' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Check outcome is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER check_outcome_immutable BEFORE UPDATE ON customer.check_attempts FOR EACH ROW EXECUTE FUNCTION customer.preserve_check_outcome();
--> statement-breakpoint
ALTER TABLE customer.registration_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.registration_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.registration_enrollments
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
--> statement-breakpoint
ALTER TABLE customer.passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.passkey_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.passkey_credentials
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
--> statement-breakpoint
ALTER TABLE customer.recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.recovery_codes
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
