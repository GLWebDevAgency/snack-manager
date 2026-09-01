CREATE TABLE "loyalty"."earn_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"source" "loyalty"."ledger_source" NOT NULL,
	"external_ref" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty"."earn_receipts" ADD CONSTRAINT "earn_receipts_tenant_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."earn_receipts" ADD CONSTRAINT "earn_receipts_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earn_receipts_tenant_source_external_ref_uq" ON "loyalty"."earn_receipts" USING btree ("tenant_ref","source","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "earn_receipts_tenant_operation_uq" ON "loyalty"."earn_receipts" USING btree ("tenant_ref","operation_id");--> statement-breakpoint
CREATE INDEX "earn_receipts_tenant_member_idx" ON "loyalty"."earn_receipts" USING btree ("tenant_ref","member_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_redeem_external_ref_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","source","external_ref") WHERE "loyalty"."ledger_entries"."kind" = 'redeem' AND "loyalty"."ledger_entries"."external_ref" IS NOT NULL;--> statement-breakpoint

-- Les gains historiques portant une référence ont déjà consommé leur
-- ticket. Le backfill empêche qu'ils redeviennent rejouables après migration.
INSERT INTO "loyalty"."earn_receipts" (
  "tenant_ref", "source", "external_ref", "operation_id", "member_id", "claimed_at"
)
SELECT
  "tenant_ref", "source", "external_ref", "operation_id", "member_id", "recorded_at"
FROM "loyalty"."ledger_entries"
WHERE "kind" = 'earn' AND "external_ref" IS NOT NULL;--> statement-breakpoint

-- Un reçu d'achat est une preuve métier append-only, y compris lorsqu'aucun
-- mouvement de ledger n'a été produit (achat sous le minimum).
CREATE TRIGGER "earn_receipts_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty"."earn_receipts"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."reject_immutable_event"();--> statement-breakpoint

-- La boucle RLS de la migration initiale ne pouvait pas connaître cette table.
ALTER TABLE "loyalty"."earn_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty"."earn_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "loyalty"."earn_receipts"
  USING ("tenant_ref" = current_setting('app.tenant_ref', true))
  WITH CHECK ("tenant_ref" = current_setting('app.tenant_ref', true));
