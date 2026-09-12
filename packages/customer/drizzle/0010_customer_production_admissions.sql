-- Target admission is independent of SMS budget, depletion and expiry.
CREATE TABLE "customer"."production_admission_policies" (
  parent_ref text PRIMARY KEY REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL CHECK (tenant_ref ~ '^[a-zA-Z0-9_-]{1,160}$'),
  policy_ref text NOT NULL CHECK (policy_ref ~ '^[a-zA-Z0-9_-]{1,120}$'),
  window_ms bigint NOT NULL CHECK (window_ms BETWEEN 60000 AND 86400000),
  browser_source_limit integer NOT NULL CHECK (browser_source_limit BETWEEN 1 AND 1000),
  browser_tenant_limit integer NOT NULL CHECK (browser_tenant_limit BETWEEN 1 AND 100000),
  browser_parent_limit integer NOT NULL CHECK (browser_parent_limit BETWEEN 1 AND 100000),
  intent_browser_limit integer NOT NULL CHECK (intent_browser_limit BETWEEN 1 AND 1000),
  intent_source_limit integer NOT NULL CHECK (intent_source_limit BETWEEN 1 AND 1000),
  intent_tenant_limit integer NOT NULL CHECK (intent_tenant_limit BETWEEN 1 AND 100000),
  intent_parent_limit integer NOT NULL CHECK (intent_parent_limit BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
  UNIQUE(parent_ref,tenant_ref,policy_ref)
);
ALTER TABLE customer.production_admission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.production_admission_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.production_admission_policies
  USING(parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK(parent_ref=current_setting('app.customer_parent_ref',true) AND tenant_ref=current_setting('app.tenant_ref',true));
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_production_admission_policy"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Production admission policy is durable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Production admission policy must be active' USING ERRCODE='23514'; END IF;
    INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
      VALUES(NEW.parent_ref,1,0,0) ON CONFLICT DO NOTHING;
    PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
    NEW.created_at=clock_timestamp();
  ELSIF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Production admission policy is durable' USING ERRCODE='23514';
  ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN NEW.revoked_at=clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER production_admission_policy_preserved BEFORE INSERT OR UPDATE OR DELETE ON customer.production_admission_policies
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_production_admission_policy();
CREATE TRIGGER production_admission_policy_no_truncate BEFORE TRUNCATE ON customer.production_admission_policies
  FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_production_admission_policy();
REVOKE ALL ON FUNCTION customer.preserve_production_admission_policy() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "customer"."guard_production_cutover"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  IF NEW.funding_kind<>'production_paid' AND EXISTS(SELECT 1 FROM customer.production_admission_policies WHERE parent_ref=NEW.parent_ref) THEN
    RAISE EXCEPTION 'Legacy funding is sealed after production admission' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER production_cutover_guard BEFORE INSERT ON customer.reservations
  FOR EACH ROW EXECUTE FUNCTION customer.guard_production_cutover();
--> statement-breakpoint
-- The durable journals remain intact; only NEW production admissions use windows.
ALTER TABLE customer.browser_preparations ADD COLUMN production_admission_policy_ref text,
  ADD COLUMN admission_source_hash text,
  ADD CONSTRAINT browser_production_admission CHECK ((production_admission_policy_ref IS NULL AND admission_source_hash IS NULL)
    OR (production_admission_policy_ref IS NOT NULL AND admission_source_hash IS NOT NULL AND admission_source_hash ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT browser_production_authorization_fk FOREIGN KEY(parent_ref,tenant_ref,production_admission_policy_ref)
    REFERENCES customer.production_admission_policies(parent_ref,tenant_ref,policy_ref);
ALTER TABLE customer.verification_intents ADD COLUMN production_admission_policy_ref text,
  ADD COLUMN admission_source_hash text,
  ADD CONSTRAINT intent_production_admission CHECK ((production_admission_policy_ref IS NULL AND admission_source_hash IS NULL)
    OR (production_admission_policy_ref IS NOT NULL AND admission_source_hash IS NOT NULL AND admission_source_hash ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT intent_production_authorization_fk FOREIGN KEY(parent_ref,tenant_ref,production_admission_policy_ref)
    REFERENCES customer.production_admission_policies(parent_ref,tenant_ref,policy_ref);
--> statement-breakpoint
CREATE TABLE "customer"."production_admissions" (
  parent_ref text NOT NULL, tenant_ref text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('browser','intent')),
  admission_ref uuid NOT NULL, browser_ref uuid NOT NULL,
  policy_ref text NOT NULL, source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(parent_ref,tenant_ref,kind,admission_ref),
  FOREIGN KEY(parent_ref,tenant_ref,policy_ref)
    REFERENCES customer.production_admission_policies(parent_ref,tenant_ref,policy_ref)
);
CREATE INDEX production_admissions_window ON customer.production_admissions(parent_ref,kind,admitted_at);
CREATE TRIGGER production_admission_immutable BEFORE UPDATE OR DELETE ON customer.production_admissions
  FOR EACH ROW EXECUTE FUNCTION customer.reject_immutable_record();
CREATE TRIGGER production_admission_no_truncate BEFORE TRUNCATE ON customer.production_admissions
  FOR EACH STATEMENT EXECUTE FUNCTION customer.reject_immutable_record();
ALTER TABLE customer.production_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.production_admissions FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.production_admissions
  USING(parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK(parent_ref=current_setting('app.customer_parent_ref',true) AND tenant_ref=current_setting('app.tenant_ref',true));
--> statement-breakpoint
CREATE FUNCTION "customer"."guard_production_admission"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE auth customer.production_admission_policies%ROWTYPE; counts record;
  admission_kind text; public_ref uuid; existing boolean;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.production_admission_policy_ref,NEW.admission_source_hash)
      IS DISTINCT FROM (OLD.production_admission_policy_ref,OLD.admission_source_hash) THEN
      RAISE EXCEPTION 'Admission proof is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  admission_kind=CASE WHEN TG_TABLE_NAME='browser_preparations' THEN 'browser' ELSE 'intent' END;
  IF admission_kind='browser' THEN
    public_ref=NEW.browser_ref;
    SELECT EXISTS(SELECT 1 FROM customer.browser_preparations
      WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND browser_ref=public_ref) INTO existing;
  ELSE
    public_ref=NEW.operation_id;
    SELECT EXISTS(SELECT 1 FROM customer.verification_intents
      WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND operation_id=public_ref) INTO existing;
  END IF;
  -- ON CONFLICT replays never consume quota or invent a replacement authority.
  IF existing THEN RETURN NEW; END IF;
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  SELECT * INTO auth FROM customer.production_admission_policies WHERE parent_ref=NEW.parent_ref;
  IF NOT FOUND THEN
    IF NEW.admission_source_hash IS NOT NULL THEN RETURN NULL; END IF;
    RETURN NEW;
  END IF;
  -- A binary predating production cannot bypass the new admission policy.
  IF NEW.admission_source_hash IS NULL OR auth.tenant_ref<>NEW.tenant_ref OR auth.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  NEW.production_admission_policy_ref=auth.policy_ref;
  SELECT count(*) AS parent_count,count(*) FILTER(WHERE tenant_ref=NEW.tenant_ref) AS tenant_count,
    count(*) FILTER(WHERE source_hash=NEW.admission_source_hash) AS source_count,
    count(*) FILTER(WHERE tenant_ref=NEW.tenant_ref AND browser_ref=NEW.browser_ref) AS browser_count
    INTO counts FROM customer.production_admissions
    WHERE parent_ref=NEW.parent_ref AND kind=admission_kind
      AND admitted_at>clock_timestamp()-auth.window_ms*interval '1 millisecond';
  IF (admission_kind='browser' AND (counts.parent_count>=auth.browser_parent_limit
      OR counts.tenant_count>=auth.browser_tenant_limit OR counts.source_count>=auth.browser_source_limit))
    OR (admission_kind='intent' AND (counts.parent_count>=auth.intent_parent_limit
      OR counts.tenant_count>=auth.intent_tenant_limit OR counts.source_count>=auth.intent_source_limit
      OR counts.browser_count>=auth.intent_browser_limit)) THEN RETURN NULL; END IF;
  IF admission_kind='intent' THEN
    IF NEW.proof_hash IS NOT NULL AND (SELECT count(*) FROM customer.verification_intents
    WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND browser_ref=NEW.browser_ref
      AND proof_hash IS NOT NULL AND expires_at>clock_timestamp())>=3 THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO customer.production_admissions(parent_ref,tenant_ref,kind,admission_ref,browser_ref,policy_ref,source_hash)
    VALUES(NEW.parent_ref,NEW.tenant_ref,admission_kind,public_ref,NEW.browser_ref,NEW.production_admission_policy_ref,NEW.admission_source_hash);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER browser_production_admission BEFORE INSERT OR UPDATE ON customer.browser_preparations
  FOR EACH ROW EXECUTE FUNCTION customer.guard_production_admission();
CREATE TRIGGER intent_production_admission BEFORE INSERT OR UPDATE ON customer.verification_intents
  FOR EACH ROW EXECUTE FUNCTION customer.guard_production_admission();
REVOKE ALL ON FUNCTION customer.guard_production_admission() FROM PUBLIC;
DO $$ DECLARE grant_row record; BEGIN
  FOR grant_row IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema='customer' AND table_name IN ('production_admissions','production_admission_policies') AND grantee<>current_user LOOP
    EXECUTE format('REVOKE ALL ON customer.production_admissions,customer.production_admission_policies FROM %I',grant_row.grantee);
    EXECUTE format('GRANT SELECT ON customer.production_admissions,customer.production_admission_policies TO %I',grant_row.grantee);
  END LOOP;
END $$;
