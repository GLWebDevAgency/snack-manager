-- Local code age is independent of the provider's configurable token lifetime.
-- Assumes coherent provider UTC timestamps at their stated second precision.
-- TLS authenticates their source, not the provider's internal clock alignment.
-- Their difference plus two seconds accounts for one second per timestamp,
-- without assuming the same rounding direction. The SQL challenge
-- was durably created BEFORE sending, never at response/settlement time.
ALTER TABLE customer.challenges ADD COLUMN provider_created_at timestamptz,
  ADD COLUMN provider_observed_at timestamptz;
--> statement-breakpoint
-- Existing unmeasured production attempts cannot be adopted by a new worker.
-- Keep every SID, debit, counter, completed enrollment and session unchanged.
-- Drizzle executes the migration transactionally; these owner-only alterations
-- acquire table locks and FORCE is restored before commit.
ALTER TABLE customer.challenges NO FORCE ROW LEVEL SECURITY;
ALTER TABLE customer.reservations NO FORCE ROW LEVEL SECURITY;
UPDATE customer.challenges c SET state='expired'
  FROM customer.reservations r
  WHERE (r.parent_ref,r.tenant_ref,r.challenge_id)=(c.parent_ref,c.tenant_ref,c.id)
    AND r.funding_kind='production_paid' AND c.state IN ('reserved','pending','checking');
ALTER TABLE customer.challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE customer.reservations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION customer.guard_provider_freshness() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE production boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM customer.reservations r
    WHERE (r.parent_ref,r.tenant_ref,r.challenge_id)=(NEW.parent_ref,NEW.tenant_ref,NEW.id)
      AND r.funding_kind='production_paid') INTO production;
  IF TG_OP='UPDATE' THEN
    IF production AND (NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at>OLD.expires_at) THEN
      RAISE EXCEPTION 'Production challenge lifetime cannot be renewed' USING ERRCODE='23514';
    END IF;
    IF OLD.provider_created_at IS NOT NULL AND
      (NEW.provider_created_at IS DISTINCT FROM OLD.provider_created_at
        OR NEW.provider_observed_at IS DISTINCT FROM OLD.provider_observed_at) THEN
      RAISE EXCEPTION 'Provider freshness evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF (NEW.provider_created_at IS NULL)<>(NEW.provider_observed_at IS NULL) THEN
    RAISE EXCEPTION 'Complete provider freshness evidence required' USING ERRCODE='23514';
  END IF;
  IF NEW.provider_created_at IS NOT NULL THEN
    IF NOT isfinite(NEW.provider_created_at) OR NOT isfinite(NEW.provider_observed_at)
      OR date_trunc('second',NEW.provider_created_at)<>NEW.provider_created_at
      OR date_trunc('second',NEW.provider_observed_at)<>NEW.provider_observed_at
      OR NEW.provider_created_at>NEW.provider_observed_at
      OR NEW.provider_observed_at-NEW.provider_created_at>=interval '598 seconds'
      OR NEW.expires_at>NEW.created_at+interval '598 seconds'-(NEW.provider_observed_at-NEW.provider_created_at) THEN
      RAISE EXCEPTION 'Provider age exceeds the local challenge lifetime' USING ERRCODE='23514';
    END IF;
  END IF;
  -- An old binary can still reserve money, but cannot publish a production
  -- pending challenge or consume one without the durable time evidence.
  IF production AND NEW.state IN ('pending','checking','consumed') AND NEW.provider_created_at IS NULL THEN
    RAISE EXCEPTION 'Production provider freshness evidence required' USING ERRCODE='23514';
  END IF;
  -- Final database boundary, including a delayed legacy/new enrollment writer.
  IF NEW.state='consumed' AND (TG_OP='INSERT' OR OLD.state<>'consumed')
    AND NEW.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Expired verification cannot be consumed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_freshness_guard BEFORE INSERT OR UPDATE ON customer.challenges
  FOR EACH ROW EXECUTE FUNCTION customer.guard_provider_freshness();
REVOKE ALL ON FUNCTION customer.guard_provider_freshness() FROM PUBLIC;
