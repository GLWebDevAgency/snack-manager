-- Additive adoption of existing POS gain receipts; never credits a wallet.
ALTER TABLE loyalty.sale_settlements ADD COLUMN origin text NOT NULL DEFAULT 'web_attribution';
--> statement-breakpoint
ALTER TABLE loyalty.sale_settlements ADD CONSTRAINT sale_settlements_origin CHECK(origin IN ('web_attribution','pos_receipt'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loyalty.preserve_sale_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Managed loyalty sale is durable' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.tenant_ref,NEW.client_id,NEW.earn_operation_id,NEW.member_id,NEW.program_id,NEW.rules_version,NEW.attribution,NEW.attribution_fingerprint,NEW.eligible_purchase_cents,NEW.created_at,NEW.origin)
  IS DISTINCT FROM (OLD.id,OLD.tenant_ref,OLD.client_id,OLD.earn_operation_id,OLD.member_id,OLD.program_id,OLD.rules_version,OLD.attribution,OLD.attribution_fingerprint,OLD.eligible_purchase_cents,OLD.created_at,OLD.origin)
  OR (OLD.initial_units IS NOT NULL AND (NEW.initial_units,NEW.earn_receipt_id,NEW.earn_ledger_entry_id) IS DISTINCT FROM (OLD.initial_units,OLD.earn_receipt_id,OLD.earn_ledger_entry_id))
  OR NEW.reversed_units<OLD.reversed_units OR NEW.waived_units<OLD.waived_units OR NEW.confirmed_eligible_cents<OLD.confirmed_eligible_cents
  OR NEW.latest_order_version<OLD.latest_order_version OR NEW.latest_refund_sync_version<OLD.latest_refund_sync_version OR NEW.version<>OLD.version+1
  OR (OLD.requires_resolution AND NOT NEW.requires_resolution AND NEW.reversed_units+NEW.waived_units-OLD.reversed_units-OLD.waived_units<>OLD.due_units) THEN
  RAISE EXCEPTION 'Managed loyalty sale history cannot be replaced' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loyalty.validate_sale_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT FOUND OR receipt.operation_id<>s.earn_operation_id OR receipt.member_id<>s.member_id OR (s.origin='web_attribution' AND (receipt.source<>'online' OR receipt.external_ref<>'order:'||s.client_id::text))
   OR (s.origin='pos_receipt' AND (receipt.source<>'pos'
    OR receipt.external_ref !~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR lower(split_part(receipt.external_ref,':',2))<>s.client_id::text)) THEN
   RAISE EXCEPTION 'Managed loyalty gain receipt mismatch' USING ERRCODE='23514';
  END IF;
  IF s.origin='pos_receipt' AND EXISTS(SELECT 1 FROM loyalty.ledger_entries
    WHERE tenant_ref=s.tenant_ref AND reversed_entry_id=s.earn_ledger_entry_id) THEN
   RAISE EXCEPTION 'An already reversed POS gain cannot be adopted' USING ERRCODE='23514';
  END IF;
  IF s.initial_units>0 THEN
   SELECT * INTO entry FROM loyalty.ledger_entries WHERE tenant_ref=s.tenant_ref AND id=s.earn_ledger_entry_id;
   IF NOT FOUND OR entry.operation_id<>s.earn_operation_id OR entry.member_id<>s.member_id OR entry.program_id<>s.program_id OR entry.rules_version<>s.rules_version OR entry.delta_units<>s.initial_units OR entry.kind<>'earn' OR entry.source<>receipt.source OR entry.external_ref<>receipt.external_ref THEN
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION loyalty.guard_managed_sale_reverse() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original loyalty.ledger_entries%ROWTYPE; canonical_client text;
BEGIN
 IF NEW.kind='reverse' THEN
  SELECT * INTO original FROM loyalty.ledger_entries WHERE tenant_ref=NEW.tenant_ref AND id=NEW.reversed_entry_id;
  IF FOUND AND original.kind='earn' AND original.source IN ('pos','online')
   AND original.external_ref ~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   canonical_client:=lower(split_part(original.external_ref,':',2));
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_ref||':'||canonical_client,0));
  END IF;
 END IF;
 IF NEW.kind='reverse' AND (EXISTS(SELECT 1 FROM loyalty.sale_settlements WHERE tenant_ref=NEW.tenant_ref AND earn_ledger_entry_id=NEW.reversed_entry_id)
  OR EXISTS(SELECT 1 FROM loyalty.sale_corrections WHERE tenant_ref=NEW.tenant_ref AND ledger_entry_id=NEW.reversed_entry_id)) THEN
  RAISE EXCEPTION 'Managed loyalty sale requires its correction protocol' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
