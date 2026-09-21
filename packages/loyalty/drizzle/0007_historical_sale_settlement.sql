CREATE TABLE "loyalty"."sale_corrections" (
	"tenant_ref" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"units" bigint NOT NULL,
	"before_reversed_units" bigint NOT NULL,
	"after_reversed_units" bigint NOT NULL,
	"before_waived_units" bigint NOT NULL,
	"after_waived_units" bigint NOT NULL,
	"ledger_entry_id" uuid,
	"actor_ref" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_corrections_tenant_ref_operation_id_pk" PRIMARY KEY("tenant_ref","operation_id"),
	CONSTRAINT "sale_corrections_shape" CHECK ("loyalty"."sale_corrections"."units">0 AND "loyalty"."sale_corrections"."units"<=9007199254740991 AND "loyalty"."sale_corrections"."before_reversed_units">=0 AND "loyalty"."sale_corrections"."before_waived_units">=0 AND (("loyalty"."sale_corrections"."kind"='debit' AND "loyalty"."sale_corrections"."after_reversed_units"="loyalty"."sale_corrections"."before_reversed_units"+"loyalty"."sale_corrections"."units" AND "loyalty"."sale_corrections"."after_waived_units"="loyalty"."sale_corrections"."before_waived_units" AND "loyalty"."sale_corrections"."ledger_entry_id" IS NOT NULL) OR ("loyalty"."sale_corrections"."kind"='waive' AND "loyalty"."sale_corrections"."after_waived_units"="loyalty"."sale_corrections"."before_waived_units"+"loyalty"."sale_corrections"."units" AND "loyalty"."sale_corrections"."after_reversed_units"="loyalty"."sale_corrections"."before_reversed_units" AND "loyalty"."sale_corrections"."ledger_entry_id" IS NULL AND "loyalty"."sale_corrections"."actor_ref" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."sale_observations" (
	"tenant_ref" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"financial_fingerprint" text NOT NULL,
	"order_version" bigint NOT NULL,
	"refund_sync_version" bigint NOT NULL,
	"eligible_refunded_cents" bigint,
	"pending_refund_cents" bigint NOT NULL,
	"paid_and_delivered" boolean NOT NULL,
	"proof" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_observations_tenant_ref_observation_id_pk" PRIMARY KEY("tenant_ref","observation_id"),
	CONSTRAINT "sale_observations_bounds" CHECK ("loyalty"."sale_observations"."order_version">=0 AND "loyalty"."sale_observations"."refund_sync_version">=0 AND "loyalty"."sale_observations"."pending_refund_cents" BETWEEN 0 AND 9007199254740991 AND ("loyalty"."sale_observations"."eligible_refunded_cents" IS NULL OR "loyalty"."sale_observations"."eligible_refunded_cents" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."sale_settlements" (
	"requires_resolution" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"client_id" uuid NOT NULL,
	"earn_operation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"rules_version" bigint NOT NULL,
	"attribution" jsonb NOT NULL,
	"attribution_fingerprint" text NOT NULL,
	"eligible_purchase_cents" bigint NOT NULL,
	"initial_units" bigint,
	"earn_receipt_id" uuid,
	"earn_ledger_entry_id" uuid,
	"reversed_units" bigint DEFAULT 0 NOT NULL,
	"waived_units" bigint DEFAULT 0 NOT NULL,
	"due_units" bigint DEFAULT 0 NOT NULL,
	"latest_observation_id" uuid,
	"latest_financial_fingerprint" text,
	"latest_order_version" bigint DEFAULT 0 NOT NULL,
	"latest_refund_sync_version" bigint DEFAULT 0 NOT NULL,
	"confirmed_eligible_cents" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_settlements_bounds" CHECK ("loyalty"."sale_settlements"."eligible_purchase_cents" BETWEEN 0 AND 9007199254740991 AND "loyalty"."sale_settlements"."reversed_units" >= 0 AND "loyalty"."sale_settlements"."waived_units" >= 0 AND "loyalty"."sale_settlements"."due_units" >= 0 AND "loyalty"."sale_settlements"."version" BETWEEN 0 AND 9007199254740991 AND "loyalty"."sale_settlements"."latest_order_version" >= 0 AND "loyalty"."sale_settlements"."latest_refund_sync_version" >= 0 AND "loyalty"."sale_settlements"."confirmed_eligible_cents" BETWEEN 0 AND "loyalty"."sale_settlements"."eligible_purchase_cents" AND ("loyalty"."sale_settlements"."initial_units" IS NULL OR ("loyalty"."sale_settlements"."initial_units" BETWEEN 0 AND 9007199254740991 AND "loyalty"."sale_settlements"."reversed_units"+"loyalty"."sale_settlements"."waived_units"+"loyalty"."sale_settlements"."due_units" <= "loyalty"."sale_settlements"."initial_units"))),
	CONSTRAINT "sale_settlements_initial_shape" CHECK (("loyalty"."sale_settlements"."initial_units" IS NULL AND "loyalty"."sale_settlements"."earn_receipt_id" IS NULL AND "loyalty"."sale_settlements"."earn_ledger_entry_id" IS NULL AND "loyalty"."sale_settlements"."reversed_units"=0 AND "loyalty"."sale_settlements"."waived_units"=0) OR ("loyalty"."sale_settlements"."initial_units"=0 AND "loyalty"."sale_settlements"."earn_receipt_id" IS NOT NULL AND "loyalty"."sale_settlements"."earn_ledger_entry_id" IS NULL) OR ("loyalty"."sale_settlements"."initial_units">0 AND "loyalty"."sale_settlements"."earn_receipt_id" IS NOT NULL AND "loyalty"."sale_settlements"."earn_ledger_entry_id" IS NOT NULL)),
	CONSTRAINT "sale_settlements_status_shape" CHECK (("loyalty"."sale_settlements"."status"='recorded' AND "loyalty"."sale_settlements"."reason" IS NULL AND "loyalty"."sale_settlements"."initial_units" IS NOT NULL AND "loyalty"."sale_settlements"."due_units"=0) OR ("loyalty"."sale_settlements"."status" IN ('pending','reconciliation') AND "loyalty"."sale_settlements"."reason" IS NOT NULL) OR ("loyalty"."sale_settlements"."status"='pending' AND "loyalty"."sale_settlements"."latest_observation_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sale_corrections_ledger_uq" ON "loyalty"."sale_corrections" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_observations_sale_fingerprint_uq" ON "loyalty"."sale_observations" USING btree ("tenant_ref","sale_id","financial_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_settlements_tenant_client_uq" ON "loyalty"."sale_settlements" USING btree ("tenant_ref","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_settlements_tenant_id_uq" ON "loyalty"."sale_settlements" USING btree ("tenant_ref","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_settlements_tenant_operation_uq" ON "loyalty"."sale_settlements" USING btree ("tenant_ref","earn_operation_id");--> statement-breakpoint
CREATE INDEX "sale_settlements_reconciliation_idx" ON "loyalty"."sale_settlements" USING btree ("tenant_ref","status","updated_at");--> statement-breakpoint
ALTER TABLE "loyalty"."sale_corrections" ADD CONSTRAINT "sale_corrections_sale_fk" FOREIGN KEY ("tenant_ref","sale_id") REFERENCES "loyalty"."sale_settlements"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."sale_corrections" ADD CONSTRAINT "sale_corrections_observation_fk" FOREIGN KEY ("tenant_ref","observation_id") REFERENCES "loyalty"."sale_observations"("tenant_ref","observation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."sale_corrections" ADD CONSTRAINT "sale_corrections_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."sale_observations" ADD CONSTRAINT "sale_observations_sale_fk" FOREIGN KEY ("tenant_ref","sale_id") REFERENCES "loyalty"."sale_settlements"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."sale_settlements" ADD CONSTRAINT "sale_settlements_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."sale_settlements" ADD CONSTRAINT "sale_settlements_rule_fk" FOREIGN KEY ("tenant_ref","program_id","rules_version") REFERENCES "loyalty"."program_versions"("tenant_ref","program_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- No existing receipt, wallet or ledger is rewritten. Generic history keeps its
-- existing enum: a correction is an adjust_debit with a mandatory private link.
CREATE UNIQUE INDEX earn_receipts_tenant_id_uq ON loyalty.earn_receipts(tenant_ref,id);
ALTER TABLE loyalty.sale_settlements ADD CONSTRAINT sale_settlements_receipt_fk
 FOREIGN KEY(tenant_ref,earn_receipt_id) REFERENCES loyalty.earn_receipts(tenant_ref,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE loyalty.sale_settlements ADD CONSTRAINT sale_settlements_ledger_fk
 FOREIGN KEY(tenant_ref,earn_ledger_entry_id) REFERENCES loyalty.ledger_entries(tenant_ref,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE loyalty.sale_corrections ADD CONSTRAINT sale_corrections_ledger_fk
 FOREIGN KEY(tenant_ref,ledger_entry_id) REFERENCES loyalty.ledger_entries(tenant_ref,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE loyalty.sale_settlements ADD CONSTRAINT sale_settlements_observation_fk
 FOREIGN KEY(tenant_ref,latest_observation_id) REFERENCES loyalty.sale_observations(tenant_ref,observation_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE loyalty.sale_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.sale_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty.sale_settlements USING (tenant_ref=current_setting('app.tenant_ref',true)) WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true));
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON loyalty.sale_settlements FOR EACH STATEMENT EXECUTE FUNCTION loyalty.reject_immutable_event();
ALTER TABLE loyalty.sale_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.sale_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty.sale_observations USING (tenant_ref=current_setting('app.tenant_ref',true)) WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true));
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON loyalty.sale_observations FOR EACH STATEMENT EXECUTE FUNCTION loyalty.reject_immutable_event();
ALTER TABLE loyalty.sale_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty.sale_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty.sale_corrections USING (tenant_ref=current_setting('app.tenant_ref',true)) WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true));
CREATE TRIGGER reject_truncate BEFORE TRUNCATE ON loyalty.sale_corrections FOR EACH STATEMENT EXECUTE FUNCTION loyalty.reject_immutable_event();
--> statement-breakpoint
CREATE TRIGGER sale_observations_immutable BEFORE UPDATE OR DELETE ON loyalty.sale_observations
 FOR EACH ROW EXECUTE FUNCTION loyalty.reject_immutable_event();
CREATE TRIGGER sale_corrections_immutable BEFORE UPDATE OR DELETE ON loyalty.sale_corrections
 FOR EACH ROW EXECUTE FUNCTION loyalty.reject_immutable_event();
--> statement-breakpoint
CREATE FUNCTION loyalty.guard_managed_sale_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_client uuid; managed loyalty.sale_settlements%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='sale_settlements' THEN sale_client:=NEW.client_id;
 ELSE
  IF NEW.source NOT IN ('pos','online') OR NEW.external_ref IS NULL OR NEW.external_ref !~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='ledger_entries' THEN IF NEW.kind<>'earn' THEN RETURN NEW; END IF; END IF;
  sale_client:=split_part(NEW.external_ref,':',2)::uuid;
 END IF;
 -- Old writers execute the same trigger: reserve the canonical identity even
 -- while the new writer is waiting for a proven allocation or refund outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_ref||':'||sale_client::text,0));
 SELECT * INTO managed FROM loyalty.sale_settlements WHERE tenant_ref=NEW.tenant_ref AND client_id=sale_client;
 IF TG_TABLE_NAME='sale_settlements' THEN
  IF FOUND THEN RETURN NEW; END IF;
 ELSIF FOUND THEN
  IF NEW.operation_id<>managed.earn_operation_id OR NEW.member_id<>managed.member_id THEN
   RAISE EXCEPTION 'Managed loyalty sale claim conflict' USING ERRCODE='23505';
  END IF;
  IF TG_TABLE_NAME='ledger_entries' THEN IF NEW.program_id<>managed.program_id OR NEW.rules_version<>managed.rules_version OR NEW.delta_units IS DISTINCT FROM managed.initial_units THEN
   RAISE EXCEPTION 'Managed loyalty gain mismatch' USING ERRCODE='23514';
  END IF; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_settlements_claim BEFORE INSERT ON loyalty.sale_settlements FOR EACH ROW EXECUTE FUNCTION loyalty.guard_managed_sale_claim();
CREATE TRIGGER earn_receipts_managed_claim BEFORE INSERT ON loyalty.earn_receipts FOR EACH ROW EXECUTE FUNCTION loyalty.guard_managed_sale_claim();
CREATE TRIGGER ledger_managed_claim BEFORE INSERT ON loyalty.ledger_entries FOR EACH ROW EXECUTE FUNCTION loyalty.guard_managed_sale_claim();
--> statement-breakpoint
CREATE FUNCTION loyalty.guard_managed_sale_reverse() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='reverse' AND (EXISTS(SELECT 1 FROM loyalty.sale_settlements WHERE tenant_ref=NEW.tenant_ref AND earn_ledger_entry_id=NEW.reversed_entry_id)
  OR EXISTS(SELECT 1 FROM loyalty.sale_corrections WHERE tenant_ref=NEW.tenant_ref AND ledger_entry_id=NEW.reversed_entry_id)) THEN
  RAISE EXCEPTION 'Managed loyalty sale requires its correction protocol' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_managed_reverse BEFORE INSERT ON loyalty.ledger_entries FOR EACH ROW EXECUTE FUNCTION loyalty.guard_managed_sale_reverse();
--> statement-breakpoint
CREATE FUNCTION loyalty.preserve_sale_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Managed loyalty sale is durable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.tenant_ref,NEW.client_id,NEW.earn_operation_id,NEW.member_id,NEW.program_id,NEW.rules_version,NEW.attribution,NEW.attribution_fingerprint,NEW.eligible_purchase_cents,NEW.created_at)
  IS DISTINCT FROM (OLD.id,OLD.tenant_ref,OLD.client_id,OLD.earn_operation_id,OLD.member_id,OLD.program_id,OLD.rules_version,OLD.attribution,OLD.attribution_fingerprint,OLD.eligible_purchase_cents,OLD.created_at)
  OR (OLD.initial_units IS NOT NULL AND (NEW.initial_units,NEW.earn_receipt_id,NEW.earn_ledger_entry_id) IS DISTINCT FROM (OLD.initial_units,OLD.earn_receipt_id,OLD.earn_ledger_entry_id))
  OR NEW.reversed_units<OLD.reversed_units OR NEW.waived_units<OLD.waived_units OR NEW.confirmed_eligible_cents<OLD.confirmed_eligible_cents
  OR NEW.latest_order_version<OLD.latest_order_version OR NEW.latest_refund_sync_version<OLD.latest_refund_sync_version OR NEW.version<>OLD.version+1
  OR (OLD.requires_resolution AND NOT NEW.requires_resolution AND NEW.reversed_units+NEW.waived_units-OLD.reversed_units-OLD.waived_units<>OLD.due_units) THEN
  RAISE EXCEPTION 'Managed loyalty sale history cannot be replaced' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sale_settlements_preserve BEFORE UPDATE OR DELETE ON loyalty.sale_settlements FOR EACH ROW EXECUTE FUNCTION loyalty.preserve_sale_settlement();
--> statement-breakpoint
CREATE FUNCTION loyalty.validate_sale_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s loyalty.sale_settlements%ROWTYPE; receipt loyalty.earn_receipts%ROWTYPE; entry loyalty.ledger_entries%ROWTYPE; total_debit bigint; total_waived bigint; target_id uuid;
BEGIN
 IF TG_TABLE_NAME='sale_settlements' THEN target_id:=NEW.id; ELSE target_id:=NEW.sale_id; END IF;
 SELECT * INTO s FROM loyalty.sale_settlements WHERE tenant_ref=NEW.tenant_ref AND id=target_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Managed loyalty sale missing' USING ERRCODE='23503'; END IF;
 SELECT coalesce(sum(units) FILTER(WHERE kind='debit'),0),coalesce(sum(units) FILTER(WHERE kind='waive'),0) INTO total_debit,total_waived
 FROM loyalty.sale_corrections WHERE tenant_ref=s.tenant_ref AND sale_id=s.id;
 IF total_debit<>s.reversed_units OR total_waived<>s.waived_units THEN RAISE EXCEPTION 'Managed loyalty cumulative projection mismatch' USING ERRCODE='23514'; END IF;
 IF s.latest_observation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM loyalty.sale_observations WHERE tenant_ref=s.tenant_ref AND observation_id=s.latest_observation_id AND sale_id=s.id AND financial_fingerprint=s.latest_financial_fingerprint) THEN RAISE EXCEPTION 'Managed loyalty observation mismatch' USING ERRCODE='23514'; END IF;
 IF s.initial_units IS NOT NULL THEN
  SELECT * INTO receipt FROM loyalty.earn_receipts WHERE tenant_ref=s.tenant_ref AND id=s.earn_receipt_id;
  IF NOT FOUND OR receipt.operation_id<>s.earn_operation_id OR receipt.member_id<>s.member_id OR receipt.source<>'online' OR receipt.external_ref<>'order:'||s.client_id::text THEN
   RAISE EXCEPTION 'Managed loyalty gain receipt mismatch' USING ERRCODE='23514';
  END IF;
  IF s.initial_units>0 THEN
   SELECT * INTO entry FROM loyalty.ledger_entries WHERE tenant_ref=s.tenant_ref AND id=s.earn_ledger_entry_id;
   IF NOT FOUND OR entry.operation_id<>s.earn_operation_id OR entry.member_id<>s.member_id OR entry.program_id<>s.program_id OR entry.rules_version<>s.rules_version OR entry.delta_units<>s.initial_units OR entry.kind<>'earn' THEN
    RAISE EXCEPTION 'Managed loyalty gain ledger mismatch' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='sale_corrections' THEN
  IF NOT EXISTS(SELECT 1 FROM loyalty.sale_observations WHERE tenant_ref=NEW.tenant_ref AND observation_id=NEW.observation_id AND sale_id=s.id) THEN RAISE EXCEPTION 'Correction observation belongs to another sale' USING ERRCODE='23514'; END IF;
  IF NEW.kind='debit' THEN
  SELECT * INTO entry FROM loyalty.ledger_entries WHERE tenant_ref=NEW.tenant_ref AND id=NEW.ledger_entry_id;
  IF NOT FOUND OR entry.operation_id<>NEW.operation_id OR entry.member_id<>s.member_id OR entry.program_id<>s.program_id OR entry.rules_version<>s.rules_version OR entry.kind<>'adjust_debit' OR entry.delta_units<>-NEW.units THEN
   RAISE EXCEPTION 'Managed loyalty correction ledger mismatch' USING ERRCODE='23514';
  END IF;
 END IF; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sale_settlements_validate AFTER INSERT OR UPDATE ON loyalty.sale_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_sale_settlement();
CREATE CONSTRAINT TRIGGER sale_corrections_validate AFTER INSERT ON loyalty.sale_corrections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION loyalty.validate_sale_settlement();

--> statement-breakpoint
CREATE FUNCTION loyalty.guard_sale_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s loyalty.sale_settlements%ROWTYPE;
BEGIN
 SELECT * INTO s FROM loyalty.sale_settlements WHERE tenant_ref=NEW.tenant_ref AND id=NEW.sale_id FOR UPDATE;
 IF NOT FOUND OR NEW.observation_id IS DISTINCT FROM s.latest_observation_id
  OR NEW.before_reversed_units<>s.reversed_units OR NEW.before_waived_units<>s.waived_units OR NEW.units<>s.due_units THEN
  RAISE EXCEPTION 'Correction must consume the current cumulative due' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sale_corrections_guard BEFORE INSERT ON loyalty.sale_corrections FOR EACH ROW EXECUTE FUNCTION loyalty.guard_sale_correction();
--> statement-breakpoint
-- Existing generic operation semantics are unchanged. Only receipts owned by
-- this new protocol become immutable after completion (including failed retry).
CREATE FUNCTION loyalty.preserve_sale_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='completed' AND (
  OLD.result ? 'resolutionActorRef'
  OR EXISTS(SELECT 1 FROM loyalty.sale_settlements WHERE tenant_ref=OLD.tenant_ref AND earn_operation_id=OLD.operation_id)
  OR EXISTS(SELECT 1 FROM loyalty.sale_corrections WHERE tenant_ref=OLD.tenant_ref AND operation_id=OLD.operation_id)) THEN
  RAISE EXCEPTION 'Managed loyalty operation receipt is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operations_managed_sale_preserve BEFORE UPDATE OR DELETE ON loyalty.operations FOR EACH ROW EXECUTE FUNCTION loyalty.preserve_sale_operation();
--> statement-breakpoint
CREATE INDEX operations_sale_resolution_receipts_idx ON loyalty.operations
 (tenant_ref, (result->>'clientId'), (result->>'resolutionActorRef'), completed_at DESC)
 WHERE kind='adjust' AND status='completed' AND result ? 'resolutionActorRef';
