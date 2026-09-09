-- Deploy with the pilot closed. Historical keys/codes/publications are retained.
ALTER TABLE customer.passkey_credentials DROP CONSTRAINT passkey_credentials_parent_ref_tenant_ref_account_id_key;
--> statement-breakpoint
CREATE UNIQUE INDEX passkey_active_account_idx ON customer.passkey_credentials(parent_ref,tenant_ref,account_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE customer.recovery_codes ADD CONSTRAINT recovery_source_binding_unique UNIQUE(parent_ref,tenant_ref,account_id,version,code_hash);
--> statement-breakpoint
CREATE TABLE "customer"."credential_access_attempts" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, operation_id uuid NOT NULL, id uuid NOT NULL,
  browser_ref uuid NOT NULL, browser_hash text NOT NULL, browser_generation bigint NOT NULL,
  method text NOT NULL CHECK(method IN ('passkey','recovery')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  origin text, rp_id text, challenge text,
  request_hash text CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('prepared','checking','failed','denied','granted','approved')),
  account_id uuid, account_version bigint CHECK(account_version BETWEEN 0 AND 9007199254740991),
  credential jsonb, user_handle text, session_id uuid, completed_at timestamptz,
  PRIMARY KEY(parent_ref,tenant_ref,operation_id,id),
  FOREIGN KEY(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation)
    REFERENCES customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation),
  FOREIGN KEY(parent_ref,tenant_ref,account_id) REFERENCES customer.accounts(parent_ref,tenant_ref,id),
  FOREIGN KEY(parent_ref,tenant_ref,session_id) REFERENCES customer.sessions(parent_ref,tenant_ref,id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CHECK((method='passkey' AND origin IS NOT NULL AND length(origin) BETWEEN 1 AND 2048 AND rp_id IS NOT NULL
    AND length(rp_id) BETWEEN 1 AND 253 AND challenge IS NOT NULL AND challenge ~ '^[A-Za-z0-9_-]{43}$')
    OR (method='recovery' AND origin IS NULL AND rp_id IS NULL AND challenge IS NULL)),
  CHECK((account_id IS NULL)=(account_version IS NULL)),
  CHECK(credential IS NULL OR (method='passkey' AND account_id IS NOT NULL AND user_handle ~ '^[A-Za-z0-9_-]{43}$'
    AND jsonb_typeof(credential)='object' AND octet_length(credential::text)<=16384)),
  CHECK((state IN ('prepared','checking'))=(completed_at IS NULL)),
  CHECK(state='prepared' OR request_hash IS NOT NULL),
  CHECK((state='approved')=(session_id IS NOT NULL)),
  CHECK(method<>'recovery' OR state IN ('denied','granted')),
  CHECK(method<>'passkey' OR state IN ('prepared','checking','failed','approved')),
  CHECK(state<>'checking' OR (credential IS NOT NULL AND account_id IS NOT NULL)),
  CHECK(state<>'granted' OR account_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "customer"."credential_auth_reservations" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, operation_id uuid NOT NULL, attempt_id uuid NOT NULL,
  browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'), source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  method text NOT NULL CHECK(method IN ('passkey','recovery')), reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(parent_ref,tenant_ref,operation_id,attempt_id),
  FOREIGN KEY(parent_ref,tenant_ref,operation_id,attempt_id)
    REFERENCES customer.credential_access_attempts(parent_ref,tenant_ref,operation_id,id)
);
--> statement-breakpoint
CREATE INDEX credential_quota_parent_time_idx ON customer.credential_auth_reservations(parent_ref,reserved_at);
--> statement-breakpoint
CREATE TABLE "customer"."account_recovery_grants" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL, operation_id uuid NOT NULL, id uuid NOT NULL,
  browser_ref uuid NOT NULL, browser_hash text NOT NULL, browser_generation bigint NOT NULL,
  account_id uuid NOT NULL, account_version bigint NOT NULL CHECK(account_version BETWEEN 0 AND 9007199254740990),
  source_version bigint NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740990), source_hash text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed','expired','activated')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
  registration_id uuid, origin text, rp_id text, registration_challenge text, user_handle text,
  registration_request_hash text CHECK(registration_request_hash ~ '^[a-f0-9]{64}$'), credential jsonb,
  registration_counter bigint CHECK(registration_counter BETWEEN 0 AND 4294967295),
  assertion_id uuid, assertion_challenge text, assertion_request_hash text CHECK(assertion_request_hash ~ '^[a-f0-9]{64}$'), asserted_at timestamptz,
  recovery_receipts jsonb NOT NULL DEFAULT '[]', activation_intent_id uuid,
  failed_confirmations integer NOT NULL DEFAULT 0 CHECK(failed_confirmations BETWEEN 0 AND 5),
  activation_id uuid, activation_request_hash text CHECK(activation_request_hash ~ '^[a-f0-9]{64}$'), activated_at timestamptz, session_id uuid,
  PRIMARY KEY(parent_ref,tenant_ref,operation_id,id),
  FOREIGN KEY(parent_ref,tenant_ref,operation_id,id) REFERENCES customer.credential_access_attempts(parent_ref,tenant_ref,operation_id,id),
  FOREIGN KEY(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation)
    REFERENCES customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation),
  FOREIGN KEY(parent_ref,tenant_ref,account_id,source_version,source_hash)
    REFERENCES customer.recovery_codes(parent_ref,tenant_ref,account_id,version,code_hash),
  FOREIGN KEY(parent_ref,tenant_ref,session_id) REFERENCES customer.sessions(parent_ref,tenant_ref,id),
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
  CHECK(num_nonnulls(registration_id,origin,rp_id,registration_challenge,user_handle) IN (0,5)),
  CHECK(registration_id IS NULL OR (length(origin) BETWEEN 1 AND 2048 AND length(rp_id) BETWEEN 1 AND 253
    AND registration_challenge ~ '^[A-Za-z0-9_-]{43}$' AND user_handle ~ '^[A-Za-z0-9_-]{43}$')),
  CHECK((registration_request_hash IS NULL)=(credential IS NULL) AND (registration_counter IS NULL)=(credential IS NULL)),
  CHECK(credential IS NULL OR (registration_id IS NOT NULL AND jsonb_typeof(credential)='object' AND octet_length(credential::text)<=16384)),
  CHECK((assertion_id IS NULL)=(assertion_challenge IS NULL)),
  CHECK(assertion_challenge IS NULL OR (credential IS NOT NULL AND assertion_challenge ~ '^[A-Za-z0-9_-]{43}$')),
  CHECK((assertion_request_hash IS NULL)=(asserted_at IS NULL)),
  CHECK(asserted_at IS NULL OR (assertion_id IS NOT NULL AND asserted_at>=created_at AND asserted_at<expires_at)),
  CHECK(jsonb_typeof(recovery_receipts)='array' AND jsonb_array_length(recovery_receipts)<=3),
  CHECK(jsonb_array_length(recovery_receipts)=0 OR asserted_at IS NOT NULL),
  CHECK((state='activated')=(activation_id IS NOT NULL)),
  CHECK(num_nonnulls(activation_id,activation_request_hash,activated_at,session_id) IN (0,4)),
  CHECK(activation_id IS NULL OR (activation_intent_id IS NOT NULL AND activation_id=activation_intent_id
    AND asserted_at IS NOT NULL AND jsonb_array_length(recovery_receipts)>0 AND activated_at<expires_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX recovery_grant_open_account_idx ON customer.account_recovery_grants(parent_ref,tenant_ref,account_id) WHERE state='open';
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_credential_access_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Access receipt is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.operation_id,NEW.id,NEW.browser_ref,NEW.browser_hash,NEW.browser_generation,NEW.method,NEW.created_at,NEW.expires_at,NEW.origin,NEW.rp_id,NEW.challenge)
    IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.operation_id,OLD.id,OLD.browser_ref,OLD.browser_hash,OLD.browser_generation,OLD.method,OLD.created_at,OLD.expires_at,OLD.origin,OLD.rp_id,OLD.challenge)
    OR (OLD.state NOT IN ('prepared','checking') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.request_hash IS NOT NULL AND NEW.request_hash IS DISTINCT FROM OLD.request_hash)
    OR (OLD.account_id IS NOT NULL AND (NEW.account_id,NEW.account_version,NEW.credential,NEW.user_handle)
      IS DISTINCT FROM (OLD.account_id,OLD.account_version,OLD.credential,OLD.user_handle))
    OR (OLD.state='checking' AND NEW.state NOT IN ('checking','failed','approved')) THEN
    RAISE EXCEPTION 'Access receipt is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credential_attempt_immutable BEFORE UPDATE OR DELETE ON customer.credential_access_attempts FOR EACH ROW EXECUTE FUNCTION customer.preserve_credential_access_attempt();
--> statement-breakpoint
CREATE TRIGGER credential_attempt_no_truncate BEFORE TRUNCATE ON customer.credential_access_attempts FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_credential_access_attempt();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_credential_auth_reservation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authentication reservation is immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER credential_reservation_immutable BEFORE UPDATE OR DELETE ON customer.credential_auth_reservations FOR EACH ROW EXECUTE FUNCTION customer.preserve_credential_auth_reservation();
--> statement-breakpoint
CREATE TRIGGER credential_reservation_no_truncate BEFORE TRUNCATE ON customer.credential_auth_reservations FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_credential_auth_reservation();
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_account_recovery_grant"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE idx integer;
BEGIN
  IF TG_WHEN='AFTER' THEN
    IF NEW.state='activated' AND NOT EXISTS(SELECT 1 FROM customer.accounts a
      JOIN customer.recovery_codes old_code ON (old_code.parent_ref,old_code.tenant_ref,old_code.account_id)=(a.parent_ref,a.tenant_ref,a.id)
      JOIN customer.recovery_codes new_code ON (new_code.parent_ref,new_code.tenant_ref,new_code.account_id)=(a.parent_ref,a.tenant_ref,a.id)
      JOIN customer.passkey_credentials k ON (k.parent_ref,k.tenant_ref,k.account_id)=(a.parent_ref,a.tenant_ref,a.id)
      JOIN customer.sessions s ON (s.parent_ref,s.tenant_ref,s.account_id)=(a.parent_ref,a.tenant_ref,a.id)
      JOIN customer.session_publications u ON (u.parent_ref,u.tenant_ref,u.session_id)=(s.parent_ref,s.tenant_ref,s.id)
      WHERE a.parent_ref=NEW.parent_ref AND a.tenant_ref=NEW.tenant_ref AND a.id=NEW.account_id
        AND a.session_version=NEW.account_version+1 AND old_code.version=NEW.source_version AND old_code.code_hash=NEW.source_hash AND old_code.consumed_at IS NOT NULL
        AND new_code.version=NEW.source_version+1 AND new_code.code_hash=NEW.recovery_receipts->-1->>'codeHash' AND new_code.consumed_at IS NULL AND new_code.revoked_at IS NULL
        AND k.credential_id=NEW.credential->>'credentialId' AND k.rp_id=NEW.rp_id AND k.revoked_at IS NULL
        AND s.id=NEW.session_id AND s.account_version=a.session_version
        AND u.operation_id=NEW.operation_id AND u.check_id=NEW.activation_id AND u.method='recovery') THEN
      RAISE EXCEPTION 'Atomic reprotection required' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Recovery grant is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.operation_id,NEW.id,NEW.browser_ref,NEW.browser_hash,NEW.browser_generation,NEW.account_id,NEW.account_version,NEW.source_version,NEW.source_hash,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.operation_id,OLD.id,OLD.browser_ref,OLD.browser_hash,OLD.browser_generation,OLD.account_id,OLD.account_version,OLD.source_version,OLD.source_hash,OLD.created_at,OLD.expires_at)
    OR (OLD.state<>'open' AND NEW IS DISTINCT FROM OLD)
    OR (OLD.registration_id IS NOT NULL AND (NEW.registration_id,NEW.origin,NEW.rp_id,NEW.registration_challenge,NEW.user_handle)
      IS DISTINCT FROM (OLD.registration_id,OLD.origin,OLD.rp_id,OLD.registration_challenge,OLD.user_handle))
    OR (OLD.registration_request_hash IS NOT NULL AND NEW.registration_request_hash IS DISTINCT FROM OLD.registration_request_hash)
    OR (OLD.registration_counter IS NOT NULL AND NEW.registration_counter IS DISTINCT FROM OLD.registration_counter)
    OR (OLD.credential IS NOT NULL AND (NEW.credential IS NULL OR (NEW.credential-'counter'-'backedUp') IS DISTINCT FROM (OLD.credential-'counter'-'backedUp')
      OR (NEW.credential->>'counter')::bigint<(OLD.credential->>'counter')::bigint))
    OR (OLD.assertion_id IS NOT NULL AND (NEW.assertion_id,NEW.assertion_challenge) IS DISTINCT FROM (OLD.assertion_id,OLD.assertion_challenge))
    OR (OLD.asserted_at IS NOT NULL AND (NEW.assertion_request_hash,NEW.asserted_at,NEW.credential) IS DISTINCT FROM (OLD.assertion_request_hash,OLD.asserted_at,OLD.credential))
    OR (OLD.activation_intent_id IS NOT NULL AND NEW.activation_intent_id IS DISTINCT FROM OLD.activation_intent_id)
    OR NEW.failed_confirmations<OLD.failed_confirmations OR jsonb_array_length(NEW.recovery_receipts)<jsonb_array_length(OLD.recovery_receipts)
    OR (clock_timestamp()>=OLD.expires_at AND (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')) THEN
    RAISE EXCEPTION 'Recovery grant is immutable' USING ERRCODE='23514';
  END IF;
  FOR idx IN 0..jsonb_array_length(OLD.recovery_receipts)-1 LOOP
    IF NEW.recovery_receipts->idx IS DISTINCT FROM OLD.recovery_receipts->idx THEN RAISE EXCEPTION 'Recovery grant is immutable' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recovery_grant_immutable BEFORE UPDATE OR DELETE ON customer.account_recovery_grants FOR EACH ROW EXECUTE FUNCTION customer.preserve_account_recovery_grant();
--> statement-breakpoint
CREATE TRIGGER recovery_grant_no_truncate BEFORE TRUNCATE ON customer.account_recovery_grants FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_account_recovery_grant();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER recovery_grant_atomic AFTER UPDATE ON customer.account_recovery_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer.preserve_account_recovery_grant();
--> statement-breakpoint
ALTER TABLE customer.credential_access_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.credential_access_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.credential_access_attempts
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
--> statement-breakpoint
ALTER TABLE customer.account_recovery_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.account_recovery_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer.account_recovery_grants
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
--> statement-breakpoint
ALTER TABLE customer.credential_auth_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.credential_auth_reservations FORCE ROW LEVEL SECURITY;
-- Deliberately parent scoped: only pseudonymous quota metadata, no credentials/profile.
CREATE POLICY parent_isolation ON customer.credential_auth_reservations
  USING (parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (parent_ref=current_setting('app.customer_parent_ref',true) AND tenant_ref=current_setting('app.tenant_ref',true));
