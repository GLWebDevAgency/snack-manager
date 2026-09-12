-- Operator authorizations are separate from immutable pilot ceilings/receipts.
CREATE TABLE "customer"."production_budget_authorizations" (
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL CHECK (tenant_ref ~ '^[a-zA-Z0-9_-]{1,160}$'),
  authorization_ref text NOT NULL CHECK (authorization_ref ~ '^[a-zA-Z0-9_-]{1,120}$'),
  service_sid text NOT NULL CHECK (service_sid ~ '^VA[0-9a-fA-F]{32}$'),
  currency text NOT NULL CHECK (currency='USD'),
  authorized_spend_microusd bigint NOT NULL CHECK (authorized_spend_microusd BETWEEN 1 AND 9007199254740991),
  reserve_per_send_microusd bigint NOT NULL CHECK (reserve_per_send_microusd BETWEEN 1 AND 9007199254740991),
  max_send_reservations bigint NOT NULL CHECK (max_send_reservations BETWEEN 1 AND 9007199254740991),
  cost_evidence_reference text NOT NULL CHECK (cost_evidence_reference ~ '^[a-zA-Z0-9_-]{1,120}$'),
  not_before timestamptz NOT NULL CHECK (isfinite(not_before)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at>not_before),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  reserved_sends bigint NOT NULL DEFAULT 0 CHECK (reserved_sends BETWEEN 0 AND max_send_reservations),
  reserved_spend_microusd bigint NOT NULL DEFAULT 0 CHECK (reserved_spend_microusd BETWEEN 0 AND authorized_spend_microusd),
  PRIMARY KEY(parent_ref,authorization_ref),
  UNIQUE(parent_ref,tenant_ref,authorization_ref),
  CHECK (reserve_per_send_microusd<=authorized_spend_microusd)
);
--> statement-breakpoint
CREATE TABLE "customer"."production_budget_activation" (
  parent_ref text PRIMARY KEY REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL,
  authorization_ref text NOT NULL,
  FOREIGN KEY(parent_ref,tenant_ref,authorization_ref)
    REFERENCES customer.production_budget_authorizations(parent_ref,tenant_ref,authorization_ref)
);
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_production_authorization"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Production authorization cannot be reset' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.reserved_sends<>0 OR NEW.reserved_spend_microusd<>0 OR NEW.activated_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Production authorization must be unspent' USING ERRCODE='23514';
    END IF;
    -- A closed legacy lock anchor, never a paid credit/default allowance.
    INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
      VALUES(NEW.parent_ref,1,0,0) ON CONFLICT DO NOTHING;
    PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
    NEW.created_at=clock_timestamp();
  ELSE
    IF (to_jsonb(NEW)-ARRAY['reserved_sends','reserved_spend_microusd','activated_at','revoked_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reserved_sends','reserved_spend_microusd','activated_at','revoked_at'])
      OR NEW.reserved_sends<OLD.reserved_sends OR NEW.reserved_spend_microusd<OLD.reserved_spend_microusd
      OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Production authorization cannot be reset' USING ERRCODE='23514';
    END IF;
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN NEW.revoked_at=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER production_authorization_preserved BEFORE INSERT OR UPDATE OR DELETE ON customer.production_budget_authorizations
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_production_authorization();
CREATE TRIGGER production_authorization_no_truncate BEFORE TRUNCATE ON customer.production_budget_authorizations
  FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_production_authorization();
--> statement-breakpoint
CREATE FUNCTION "customer"."activate_production_authorization"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE auth customer.production_budget_authorizations%ROWTYPE;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Production cutover cannot be reset' USING ERRCODE='23514';
  END IF;
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  IF TG_OP='UPDATE' AND (NEW.parent_ref,NEW.tenant_ref) IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref) THEN
    RAISE EXCEPTION 'Production cutover scope is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND NEW.authorization_ref=OLD.authorization_ref THEN RETURN NEW; END IF;
  SELECT * INTO auth FROM customer.production_budget_authorizations
    WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND authorization_ref=NEW.authorization_ref FOR UPDATE;
  IF NOT FOUND OR auth.activated_at IS NOT NULL OR auth.revoked_at IS NOT NULL
    OR auth.not_before>clock_timestamp() OR auth.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Production authorization unavailable' USING ERRCODE='23514';
  END IF;
  UPDATE customer.production_budget_authorizations SET activated_at=clock_timestamp()
    WHERE parent_ref=NEW.parent_ref AND authorization_ref=NEW.authorization_ref;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER production_activation_preserved BEFORE INSERT OR UPDATE OR DELETE ON customer.production_budget_activation
  FOR EACH ROW EXECUTE FUNCTION customer.activate_production_authorization();
CREATE TRIGGER production_activation_no_truncate BEFORE TRUNCATE ON customer.production_budget_activation
  FOR EACH STATEMENT EXECUTE FUNCTION customer.activate_production_authorization();
--> statement-breakpoint
ALTER TABLE customer.production_budget_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.production_budget_authorizations FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.production_budget_authorizations
  USING(parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK(parent_ref=current_setting('app.customer_parent_ref',true) AND tenant_ref=current_setting('app.tenant_ref',true));
ALTER TABLE customer.production_budget_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer.production_budget_activation FORCE ROW LEVEL SECURITY;
CREATE POLICY parent_isolation ON customer.production_budget_activation
  USING(parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK(parent_ref=current_setting('app.customer_parent_ref',true) AND tenant_ref=current_setting('app.tenant_ref',true));
--> statement-breakpoint
ALTER TABLE customer.reservations ADD COLUMN production_authorization_ref text,
  ADD CONSTRAINT reservation_production_authorization_fk FOREIGN KEY(parent_ref,tenant_ref,production_authorization_ref)
    REFERENCES customer.production_budget_authorizations(parent_ref,tenant_ref,authorization_ref);
ALTER TABLE customer.reservations DROP CONSTRAINT reservation_funding;
ALTER TABLE customer.reservations ADD CONSTRAINT reservation_funding CHECK (
  (funding_kind='trial' AND authorization_ref IS NULL AND production_authorization_ref IS NULL
    AND reserved_microusd=0 AND funding_expires_at IS NULL AND cost_evidence_reference IS NULL)
  OR (funding_kind IN ('paid','production_paid')
    AND ((funding_kind='paid' AND authorization_ref IS NOT NULL AND production_authorization_ref IS NULL)
      OR (funding_kind='production_paid' AND authorization_ref IS NULL AND production_authorization_ref IS NOT NULL))
    AND reserved_microusd BETWEEN 1 AND 9007199254740991
    AND cost_evidence_reference IS NOT NULL AND cost_evidence_reference ~ '^[a-zA-Z0-9_-]{1,120}$'
    AND funding_expires_at IS NOT NULL AND isfinite(funding_expires_at))
);
--> statement-breakpoint
CREATE FUNCTION "customer"."reserve_production_funding"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE auth customer.production_budget_authorizations%ROWTYPE; active record; service text;
BEGIN
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  SELECT * INTO active FROM customer.production_budget_activation WHERE parent_ref=NEW.parent_ref;
  IF NEW.funding_kind<>'production_paid' THEN
    IF FOUND THEN RAISE EXCEPTION 'Legacy funding is sealed after production cutover' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF active IS NULL OR active.tenant_ref<>NEW.tenant_ref OR active.authorization_ref<>NEW.production_authorization_ref THEN
    RAISE EXCEPTION 'Production authorization is not active' USING ERRCODE='23514';
  END IF;
  SELECT * INTO auth FROM customer.production_budget_authorizations
    WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND authorization_ref=NEW.production_authorization_ref FOR UPDATE;
  SELECT service_sid INTO service FROM customer.challenges
    WHERE parent_ref=NEW.parent_ref AND tenant_ref=NEW.tenant_ref AND id=NEW.challenge_id;
  IF auth.revoked_at IS NOT NULL OR auth.not_before>clock_timestamp() OR auth.expires_at<=clock_timestamp()
    OR service IS DISTINCT FROM auth.service_sid OR NEW.reserved_microusd<>auth.reserve_per_send_microusd
    OR NEW.cost_evidence_reference<>auth.cost_evidence_reference OR NEW.funding_expires_at<>auth.expires_at
    OR auth.reserved_sends>=auth.max_send_reservations
    OR auth.reserved_spend_microusd+NEW.reserved_microusd>auth.authorized_spend_microusd THEN
    RAISE EXCEPTION 'Production funding unavailable' USING ERRCODE='23514';
  END IF;
  UPDATE customer.production_budget_authorizations SET reserved_sends=reserved_sends+1,
    reserved_spend_microusd=reserved_spend_microusd+NEW.reserved_microusd
    WHERE parent_ref=NEW.parent_ref AND authorization_ref=NEW.production_authorization_ref;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER production_funding_reserved AFTER INSERT ON customer.reservations
  FOR EACH ROW EXECUTE FUNCTION customer.reserve_production_funding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "customer"."guard_verification_funding"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof record;
BEGIN
  PERFORM parent_ref FROM customer.parent_budgets WHERE parent_ref=NEW.parent_ref FOR UPDATE;
  SELECT r.funding_kind,r.authorization_ref,r.funding_expires_at,r.production_authorization_ref,
    p.parent_ref AS paid_parent,p.authorization_ref AS paid_authorization,p.expires_at AS paid_expiry,
    a.authorization_ref AS production_authorization,a.expires_at AS production_expiry,a.revoked_at AS production_revoked
    INTO proof FROM customer.reservations r LEFT JOIN customer.paid_budgets p ON p.parent_ref=r.parent_ref
    LEFT JOIN customer.production_budget_authorizations a ON (a.parent_ref,a.tenant_ref,a.authorization_ref)
      =(r.parent_ref,r.tenant_ref,r.production_authorization_ref)
    WHERE r.parent_ref=NEW.parent_ref AND r.tenant_ref=NEW.tenant_ref AND r.challenge_id=NEW.challenge_id;
  -- Check the ORIGINAL funding; activating B never rewrites or refunds A.
  IF NOT FOUND OR (proof.funding_kind='trial' AND proof.paid_parent IS NOT NULL)
    OR (proof.funding_kind='paid' AND (proof.paid_parent IS NULL
      OR proof.authorization_ref IS DISTINCT FROM proof.paid_authorization
      OR LEAST(proof.funding_expires_at,proof.paid_expiry)<=clock_timestamp()))
    OR (proof.funding_kind='production_paid' AND (proof.production_authorization IS NULL
      OR proof.production_revoked IS NOT NULL OR LEAST(proof.funding_expires_at,proof.production_expiry)<=clock_timestamp())) THEN
    RAISE EXCEPTION 'Customer verification funding unavailable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customer.preserve_production_authorization(),customer.activate_production_authorization(),customer.reserve_production_funding() FROM PUBLIC;
-- Remove inherited runtime write grants, including pre-existing DEFAULT PRIVILEGES.
DO $$ DECLARE grant_row record; BEGIN
  FOR grant_row IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
    WHERE table_schema='customer' AND table_name IN ('production_budget_authorizations','production_budget_activation')
      AND grantee<>current_user LOOP
    EXECUTE format('REVOKE ALL ON customer.production_budget_authorizations,customer.production_budget_activation FROM %I',grant_row.grantee);
    EXECUTE format('GRANT SELECT ON customer.production_budget_authorizations,customer.production_budget_activation TO %I',grant_row.grantee);
  END LOOP;
END $$;
