ALTER TABLE loyalty.wallets ADD COLUMN reserved_units bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE loyalty.wallets ADD CONSTRAINT wallets_reserved_bounds CHECK (reserved_units BETWEEN 0 AND balance_units);
--> statement-breakpoint
CREATE TABLE "loyalty"."order_reward_reservations" (
  tenant_ref text NOT NULL,
  client_id uuid NOT NULL,
  id uuid NOT NULL,
  member_id uuid NOT NULL,
  program_id uuid NOT NULL,
  reward_id uuid NOT NULL,
  rules_version bigint NOT NULL CONSTRAINT order_reward_rules_bounds CHECK (rules_version BETWEEN 1 AND 9007199254740991),
  cost_units bigint NOT NULL CONSTRAINT order_reward_cost_bounds CHECK (cost_units BETWEEN 1 AND 1000000),
  request_hash text NOT NULL CONSTRAINT order_reward_request_hash CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CONSTRAINT order_reward_states CHECK (state IN ('reserved','consumed','released','reversed')),
  ledger_entry_id uuid,
  reversal_entry_id uuid,
  decision_proof jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_reward_reservations_pk PRIMARY KEY (tenant_ref,client_id),
  CONSTRAINT order_reward_id_uq UNIQUE (tenant_ref,id),
  CONSTRAINT order_reward_ledger_uq UNIQUE (ledger_entry_id),
  CONSTRAINT order_reward_reversal_uq UNIQUE (reversal_entry_id),
  CONSTRAINT order_reward_wallet_fk FOREIGN KEY (tenant_ref,member_id,program_id) REFERENCES loyalty.wallets(tenant_ref,member_id,program_id) ON DELETE RESTRICT,
  CONSTRAINT order_reward_reward_fk FOREIGN KEY (tenant_ref,program_id,reward_id) REFERENCES loyalty.rewards(tenant_ref,program_id,id) ON DELETE RESTRICT,
  CONSTRAINT order_reward_rule_fk FOREIGN KEY (tenant_ref,program_id,rules_version) REFERENCES loyalty.program_versions(tenant_ref,program_id,version) ON DELETE RESTRICT,
  CONSTRAINT order_reward_ledger_fk FOREIGN KEY (tenant_ref,member_id,program_id,ledger_entry_id) REFERENCES loyalty.ledger_entries(tenant_ref,member_id,program_id,id) ON DELETE RESTRICT,
  CONSTRAINT order_reward_reversal_fk FOREIGN KEY (tenant_ref,member_id,program_id,reversal_entry_id) REFERENCES loyalty.ledger_entries(tenant_ref,member_id,program_id,id) ON DELETE RESTRICT,
  CONSTRAINT order_reward_time_order CHECK(updated_at >= created_at),
  CONSTRAINT order_reward_state_shape CHECK (
    (state='reserved' AND ledger_entry_id IS NULL AND reversal_entry_id IS NULL AND decision_proof IS NULL)
    OR (state='released' AND ledger_entry_id IS NULL AND reversal_entry_id IS NULL AND decision_proof IS NOT NULL)
    OR (state='consumed' AND ledger_entry_id IS NOT NULL AND reversal_entry_id IS NULL AND decision_proof IS NOT NULL)
    OR (state='reversed' AND ledger_entry_id IS NOT NULL AND reversal_entry_id IS NOT NULL AND decision_proof IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX order_reward_active_wallet_idx ON loyalty.order_reward_reservations(tenant_ref,member_id,program_id) WHERE state='reserved';
--> statement-breakpoint
ALTER TABLE loyalty.order_reward_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE loyalty.order_reward_reservations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_reward_tenant ON loyalty.order_reward_reservations USING (tenant_ref=current_setting('app.tenant_ref',true)) WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true));
--> statement-breakpoint
CREATE FUNCTION loyalty.preserve_order_reward_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'A reward decision cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','ledger_entry_id','reversal_entry_id','decision_proof','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['state','ledger_entry_id','reversal_entry_id','decision_proof','updated_at'])
       OR NOT ((OLD.state='reserved' AND NEW.state IN ('consumed','released')) OR (OLD.state='consumed' AND NEW.state='reversed'))
       OR (OLD.ledger_entry_id IS NOT NULL AND NEW.ledger_entry_id IS DISTINCT FROM OLD.ledger_entry_id)
       OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION 'Invalid reward decision transition';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('order-reward:'||NEW.tenant_ref||':'||NEW.client_id::text,0));
    IF NEW.state <> 'reserved' OR EXISTS(SELECT 1 FROM loyalty.order_reward_closures
      WHERE tenant_ref=NEW.tenant_ref AND client_id=NEW.client_id) THEN
      RAISE EXCEPTION 'A closed reward cannot be reserved' USING ERRCODE='23514';
    END IF;
  END IF;
  -- The SQL identity and the immutable private snapshot are one decision.
  IF (jsonb_typeof(NEW.snapshot)='object'
    AND NEW.snapshot-ARRAY['version','reservationId','clientId','owner','memberId','programId','rulesVersion','pricingHash','benefit']='{}'::jsonb
    AND NEW.snapshot @> jsonb_build_object('version',1,'reservationId',NEW.id::text,'clientId',NEW.client_id::text,
      'memberId',NEW.member_id::text,'programId',NEW.program_id::text,'rulesVersion',NEW.rules_version,
      'owner',jsonb_build_object('tenantRef',NEW.tenant_ref),
      'benefit',jsonb_build_object('rewardId',NEW.reward_id::text,'costUnits',NEW.cost_units,'policy','one-reward-no-promotion-v1'))
    AND jsonb_typeof(NEW.snapshot->'owner')='object'
    AND (NEW.snapshot->'owner')-ARRAY['tenantRef','parentRef','accountId']='{}'::jsonb
    AND jsonb_typeof(NEW.snapshot->'owner'->'parentRef')='string' AND length(NEW.snapshot->'owner'->>'parentRef') BETWEEN 1 AND 160
    AND NEW.snapshot->'owner'->>'accountId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND NEW.snapshot->>'pricingHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(NEW.snapshot->'benefit')='object'
    AND (NEW.snapshot->'benefit')-ARRAY['rewardId','name','costUnits','kind','amountCents','productRef','policy']='{}'::jsonb
    AND jsonb_typeof(NEW.snapshot->'benefit'->'name')='string' AND length(NEW.snapshot->'benefit'->>'name') BETWEEN 2 AND 80
    AND NEW.snapshot->'benefit'->>'kind' IN ('fixed_discount','product')
    AND jsonb_typeof(NEW.snapshot->'benefit'->'amountCents')='number'
    AND NEW.snapshot->'benefit'->>'amountCents' ~ '^[1-9][0-9]{0,8}$'
    AND (NEW.snapshot->'benefit'->>'amountCents')::bigint <= 100000000
    AND (NEW.snapshot->'benefit'->'productRef'='null'::jsonb OR NEW.snapshot->'benefit'->>'productRef' ~ '^[a-f0-9]{24}$')
  ) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Reward snapshot does not match its canonical reservation' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    -- Capture the current reward under the same row locks as the store. Later
    -- edits/pauses never reinterpret an already captured checkout.
    PERFORM 1 FROM loyalty.programs WHERE tenant_ref=NEW.tenant_ref AND id=NEW.program_id
      AND status='active' AND current_version=NEW.rules_version FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reward program changed before admission' USING ERRCODE='23514'; END IF;
    PERFORM 1 FROM loyalty.rewards WHERE tenant_ref=NEW.tenant_ref AND program_id=NEW.program_id AND id=NEW.reward_id
      AND active=true AND cost_units=NEW.cost_units AND name=NEW.snapshot->'benefit'->>'name'
      AND kind::text=NEW.snapshot->'benefit'->>'kind'
      AND ((kind='fixed_discount' AND NEW.snapshot->'benefit'->'productRef'='null'::jsonb
        AND (NEW.snapshot->'benefit'->>'amountCents')::bigint <= value_cents)
        OR (kind='product' AND product_ref=NEW.snapshot->'benefit'->>'productRef')) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reward value does not match the captured offer' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.state='released' THEN
      IF (NEW.decision_proof ?& ARRAY['kind','payloadHash'] AND NEW.decision_proof-ARRAY['kind','payloadHash']='{}'::jsonb
        AND NEW.decision_proof->>'kind'='admission_rejected' AND NEW.decision_proof->>'payloadHash' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Reward release proof invalid' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.state='consumed' THEN
      IF (NEW.decision_proof=jsonb_build_object('kind','order_created','orderId',NEW.decision_proof->>'orderId','pricingHash',NEW.snapshot->>'pricingHash')
        AND NEW.decision_proof->>'orderId' ~ '^[a-f0-9]{24}$') IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Reward consume proof invalid' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.state='reversed' THEN
      IF (NEW.decision_proof ?& ARRAY['kind','orderId','orderVersion','reason']
        AND NEW.decision_proof-ARRAY['kind','orderId','orderVersion','reason']='{}'::jsonb
        AND NEW.decision_proof->>'kind'='order_reversed' AND NEW.decision_proof->>'orderId'=OLD.decision_proof->>'orderId'
        AND NEW.decision_proof->>'reason' IN ('cancelled_unpaid','fully_refunded')
        AND jsonb_typeof(NEW.decision_proof->'orderVersion')='number' AND NEW.decision_proof->>'orderVersion' ~ '^[0-9]{1,16}$'
        AND (NEW.decision_proof->>'orderVersion')::numeric <= 9007199254740991) IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Reward reversal proof invalid' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER preserve_order_reward_reservation BEFORE INSERT OR UPDATE OR DELETE ON loyalty.order_reward_reservations FOR EACH ROW EXECUTE FUNCTION loyalty.preserve_order_reward_reservation();
--> statement-breakpoint
-- A terminal Mongo rejection may arrive before a delayed reservation INSERT.
-- Its tombstone shares the canonical lock with reserve, so that late INSERT
-- cannot strand points after the worker has acknowledged the rejection.
CREATE TABLE "loyalty"."order_reward_closures" (
  tenant_ref text NOT NULL,
  client_id uuid NOT NULL,
  proof jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_reward_closures_pk PRIMARY KEY (tenant_ref,client_id)
);
--> statement-breakpoint
ALTER TABLE loyalty.order_reward_closures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE loyalty.order_reward_closures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_reward_closure_tenant ON loyalty.order_reward_closures USING (tenant_ref=current_setting('app.tenant_ref',true)) WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true));
--> statement-breakpoint
CREATE TRIGGER order_reward_closure_immutable BEFORE UPDATE OR DELETE ON loyalty.order_reward_closures FOR EACH ROW EXECUTE FUNCTION loyalty.reject_immutable_event();

--> statement-breakpoint
CREATE TRIGGER order_reward_reservation_no_truncate BEFORE TRUNCATE ON loyalty.order_reward_reservations FOR EACH STATEMENT EXECUTE FUNCTION loyalty.reject_immutable_event();
CREATE TRIGGER order_reward_closure_no_truncate BEFORE TRUNCATE ON loyalty.order_reward_closures FOR EACH STATEMENT EXECUTE FUNCTION loyalty.reject_immutable_event();
--> statement-breakpoint
CREATE FUNCTION loyalty.guard_order_reward_closure() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('order-reward:'||NEW.tenant_ref||':'||NEW.client_id::text,0));
  IF (jsonb_typeof(NEW.proof)='object' AND NEW.proof ?& ARRAY['kind','payloadHash']
    AND NEW.proof-ARRAY['kind','payloadHash']='{}'::jsonb
    AND NEW.proof->>'kind'='admission_rejected' AND NEW.proof->>'payloadHash' ~ '^[a-f0-9]{64}$') IS DISTINCT FROM TRUE
    OR EXISTS(SELECT 1 FROM loyalty.order_reward_reservations WHERE tenant_ref=NEW.tenant_ref AND client_id=NEW.client_id AND state IN ('consumed','reversed')) THEN
    RAISE EXCEPTION 'Reward closure proof invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_reward_closure_guard BEFORE INSERT ON loyalty.order_reward_closures FOR EACH ROW EXECUTE FUNCTION loyalty.guard_order_reward_closure();
--> statement-breakpoint
-- The application inserts the hold before increasing wallet.reserved_units,
-- and removes it only after the debit/release. Check the final transaction,
-- never require an impossible intermediate statement order.
CREATE FUNCTION loyalty.validate_order_reward_wallet() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE held bigint; total numeric;
BEGIN
  SELECT reserved_units INTO held FROM loyalty.wallets
    WHERE tenant_ref=NEW.tenant_ref AND member_id=NEW.member_id AND program_id=NEW.program_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reward wallet missing' USING ERRCODE='23503'; END IF;
  SELECT coalesce(sum(cost_units),0) INTO total FROM loyalty.order_reward_reservations
    WHERE tenant_ref=NEW.tenant_ref AND member_id=NEW.member_id AND program_id=NEW.program_id AND state='reserved';
  IF held<>total THEN RAISE EXCEPTION 'Reward holds and wallet projection disagree' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_reward_wallet_exact AFTER INSERT OR UPDATE ON loyalty.order_reward_reservations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_wallet();
CREATE CONSTRAINT TRIGGER wallet_order_reward_exact AFTER INSERT OR UPDATE ON loyalty.wallets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_wallet();
--> statement-breakpoint
CREATE FUNCTION loyalty.validate_order_reward_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE r loyalty.order_reward_reservations%ROWTYPE; entry loyalty.ledger_entries%ROWTYPE; reversal loyalty.ledger_entries%ROWTYPE;
  redemption loyalty.redemptions%ROWTYPE; operation loyalty.operations%ROWTYPE; target_client uuid; target_tenant text;
BEGIN
  target_tenant:=NEW.tenant_ref;
  IF TG_TABLE_NAME IN ('order_reward_reservations','order_reward_closures') THEN target_client:=NEW.client_id;
  ELSIF TG_TABLE_NAME='ledger_entries' THEN
    SELECT client_id INTO target_client FROM loyalty.order_reward_reservations WHERE tenant_ref=NEW.tenant_ref
      AND (id=NEW.operation_id OR ledger_entry_id=NEW.reversed_entry_id);
  ELSE
    target_tenant:=coalesce(NEW.tenant_ref,OLD.tenant_ref);
    SELECT client_id INTO target_client FROM loyalty.order_reward_reservations WHERE tenant_ref=target_tenant
      AND id=coalesce(NEW.operation_id,OLD.operation_id);
  END IF;
  IF target_client IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM loyalty.order_reward_reservations WHERE tenant_ref=target_tenant AND client_id=target_client;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.state='released' THEN
    IF NOT EXISTS(SELECT 1 FROM loyalty.order_reward_closures WHERE tenant_ref=r.tenant_ref AND client_id=r.client_id AND proof=r.decision_proof) THEN
      RAISE EXCEPTION 'Reward release has no canonical closure' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM loyalty.order_reward_closures WHERE tenant_ref=r.tenant_ref AND client_id=r.client_id) THEN
    RAISE EXCEPTION 'Closed reward remained active' USING ERRCODE='23514';
  END IF;
  IF r.state IN ('reserved','released') AND (EXISTS(SELECT 1 FROM loyalty.ledger_entries WHERE tenant_ref=r.tenant_ref AND operation_id=r.id)
    OR EXISTS(SELECT 1 FROM loyalty.redemptions WHERE tenant_ref=r.tenant_ref AND operation_id=r.id)
    OR EXISTS(SELECT 1 FROM loyalty.operations WHERE tenant_ref=r.tenant_ref AND operation_id=r.id)) THEN
    RAISE EXCEPTION 'An unconsumed hold cannot have a debit receipt' USING ERRCODE='23514';
  END IF;
  IF r.state IN ('consumed','reversed') THEN
    SELECT * INTO entry FROM loyalty.ledger_entries WHERE tenant_ref=r.tenant_ref AND id=r.ledger_entry_id;
    IF NOT FOUND OR (entry.member_id,entry.program_id,entry.operation_id,entry.kind,entry.delta_units,entry.source,entry.external_ref,entry.rules_version)
      IS DISTINCT FROM (r.member_id,r.program_id,r.id,'redeem'::loyalty.ledger_kind,-r.cost_units,'online'::loyalty.ledger_source,'online-redemption:'||r.client_id::text,r.rules_version) THEN
      RAISE EXCEPTION 'Reward debit does not match its receipt' USING ERRCODE='23514';
    END IF;
    SELECT * INTO operation FROM loyalty.operations WHERE tenant_ref=r.tenant_ref AND operation_id=r.id;
    IF NOT FOUND OR operation.kind<>'redeem' OR operation.status<>'completed' OR operation.request_fingerprint<>r.request_hash
      OR operation.result IS DISTINCT FROM jsonb_build_object('orderReward','v1','clientId',r.client_id::text,'ledgerEntryId',r.ledger_entry_id::text) THEN
      RAISE EXCEPTION 'Reward operation receipt mismatch' USING ERRCODE='23514';
    END IF;
    SELECT * INTO redemption FROM loyalty.redemptions WHERE tenant_ref=r.tenant_ref AND operation_id=r.id;
    IF NOT FOUND OR (redemption.member_id,redemption.program_id,redemption.reward_id,redemption.ledger_entry_id,redemption.external_ref,redemption.status::text)
      IS DISTINCT FROM (r.member_id,r.program_id,r.reward_id,r.ledger_entry_id,'online-redemption:'||r.client_id::text,r.state) THEN
      RAISE EXCEPTION 'Reward redemption receipt mismatch' USING ERRCODE='23514';
    END IF;
    IF redemption.reward_snapshot IS DISTINCT FROM entry.reward_snapshot
      OR (entry.reward_snapshot->>'rulesVersion') IS DISTINCT FROM r.rules_version::text
      OR (entry.reward_snapshot->'reward'->>'id') IS DISTINCT FROM r.reward_id::text
      OR (entry.reward_snapshot->'reward'->>'costUnits') IS DISTINCT FROM r.cost_units::text THEN
      RAISE EXCEPTION 'Reward ledger snapshot mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  IF r.state='reversed' THEN
    SELECT * INTO reversal FROM loyalty.ledger_entries WHERE tenant_ref=r.tenant_ref AND id=r.reversal_entry_id;
    IF NOT FOUND OR (reversal.member_id,reversal.program_id,reversal.kind,reversal.delta_units,reversal.source,reversal.external_ref,reversal.rules_version,reversal.reversed_entry_id)
      IS DISTINCT FROM (r.member_id,r.program_id,'reverse'::loyalty.ledger_kind,r.cost_units,'online'::loyalty.ledger_source,'online-redemption:'||r.client_id::text,r.rules_version,r.ledger_entry_id) THEN
      RAISE EXCEPTION 'Reward reversal does not invert its own debit' USING ERRCODE='23514';
    END IF;
    SELECT * INTO operation FROM loyalty.operations WHERE tenant_ref=r.tenant_ref AND operation_id=reversal.operation_id;
    IF NOT FOUND OR operation.kind<>'reverse' OR operation.status<>'completed'
      OR operation.result IS DISTINCT FROM jsonb_build_object('orderRewardReversal','v1','clientId',r.client_id::text,'ledgerEntryId',r.reversal_entry_id::text) THEN
      RAISE EXCEPTION 'Reward reversal operation mismatch' USING ERRCODE='23514';
    END IF;
  ELSIF r.ledger_entry_id IS NOT NULL AND EXISTS(SELECT 1 FROM loyalty.ledger_entries WHERE tenant_ref=r.tenant_ref AND reversed_entry_id=r.ledger_entry_id) THEN
    RAISE EXCEPTION 'Managed reward cannot be reversed outside its receipt' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_reward_receipt_exact AFTER INSERT OR UPDATE ON loyalty.order_reward_reservations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_receipt();
CREATE CONSTRAINT TRIGGER order_reward_closure_exact AFTER INSERT ON loyalty.order_reward_closures
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_receipt();
CREATE CONSTRAINT TRIGGER order_reward_ledger_exact AFTER INSERT ON loyalty.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_receipt();
CREATE CONSTRAINT TRIGGER order_reward_operation_exact AFTER INSERT OR UPDATE ON loyalty.operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_receipt();
CREATE CONSTRAINT TRIGGER order_reward_redemption_exact AFTER INSERT OR UPDATE OR DELETE ON loyalty.redemptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_order_reward_receipt();
--> statement-breakpoint
CREATE FUNCTION loyalty.preserve_order_reward_operation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status='completed' AND (OLD.result->>'orderReward'='v1' OR OLD.result->>'orderRewardReversal'='v1') THEN
    RAISE EXCEPTION 'Completed reward operation is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_reward_operation_immutable BEFORE UPDATE OR DELETE ON loyalty.operations
  FOR EACH ROW EXECUTE FUNCTION loyalty.preserve_order_reward_operation();

--> statement-breakpoint
-- Trigger entry points are not a public execution API.
REVOKE ALL ON FUNCTION loyalty.preserve_order_reward_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION loyalty.guard_order_reward_closure() FROM PUBLIC;
REVOKE ALL ON FUNCTION loyalty.validate_order_reward_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION loyalty.validate_order_reward_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION loyalty.preserve_order_reward_operation() FROM PUBLIC;
