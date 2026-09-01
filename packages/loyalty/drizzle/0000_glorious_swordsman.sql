CREATE SCHEMA "loyalty";
--> statement-breakpoint
CREATE TYPE "loyalty"."consent_decision" AS ENUM('granted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "loyalty"."consent_purpose" AS ENUM('marketing_sms', 'marketing_email');--> statement-breakpoint
CREATE TYPE "loyalty"."ledger_kind" AS ENUM('earn', 'redeem', 'adjust_credit', 'adjust_debit', 'reverse', 'expire');--> statement-breakpoint
CREATE TYPE "loyalty"."ledger_source" AS ENUM('standalone', 'pos', 'online', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "loyalty"."mechanism" AS ENUM('points', 'stamps');--> statement-breakpoint
CREATE TYPE "loyalty"."member_status" AS ENUM('active', 'blocked', 'anonymized');--> statement-breakpoint
CREATE TYPE "loyalty"."membership_event_kind" AS ENUM('joined', 'blocked', 'unblocked', 'anonymized');--> statement-breakpoint
CREATE TYPE "loyalty"."operation_kind" AS ENUM('member_create', 'earn', 'redeem', 'adjust', 'consent', 'reservation', 'consume', 'reverse', 'program_publish');--> statement-breakpoint
CREATE TYPE "loyalty"."operation_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "loyalty"."program_status" AS ENUM('draft', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "loyalty"."redemption_status" AS ENUM('reserved', 'consumed', 'reversed', 'expired');--> statement-breakpoint
CREATE TYPE "loyalty"."reward_kind" AS ENUM('custom', 'fixed_discount', 'product');--> statement-breakpoint
CREATE TYPE "loyalty"."token_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "loyalty"."consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"purpose" "loyalty"."consent_purpose" NOT NULL,
	"decision" "loyalty"."consent_decision" NOT NULL,
	"notice_version" text NOT NULL,
	"source" "loyalty"."ledger_source" NOT NULL,
	"actor_ref" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty"."consent_state" (
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"purpose" "loyalty"."consent_purpose" NOT NULL,
	"decision" "loyalty"."consent_decision" NOT NULL,
	"notice_version" text NOT NULL,
	"event_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_state_tenant_ref_member_id_purpose_pk" PRIMARY KEY("tenant_ref","member_id","purpose")
);
--> statement-breakpoint
CREATE TABLE "loyalty"."ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" "loyalty"."ledger_kind" NOT NULL,
	"delta_units" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"source" "loyalty"."ledger_source" NOT NULL,
	"external_ref" text,
	"actor_ref" text,
	"device_ref" text,
	"rules_version" integer NOT NULL,
	"wallet_version" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"reward_snapshot" jsonb,
	"reversed_entry_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_delta_nonzero" CHECK ("loyalty"."ledger_entries"."delta_units" <> 0),
	CONSTRAINT "ledger_balance_nonnegative" CHECK ("loyalty"."ledger_entries"."balance_after" >= 0),
	CONSTRAINT "ledger_rules_version_positive" CHECK ("loyalty"."ledger_entries"."rules_version" > 0),
	CONSTRAINT "ledger_wallet_version_positive" CHECK ("loyalty"."ledger_entries"."wallet_version" > 0),
	CONSTRAINT "ledger_reversal_shape" CHECK ((
        ("loyalty"."ledger_entries"."kind" = 'reverse' AND "loyalty"."ledger_entries"."reversed_entry_id" IS NOT NULL)
        OR ("loyalty"."ledger_entries"."kind" <> 'reverse' AND "loyalty"."ledger_entries"."reversed_entry_id" IS NULL)
      )),
	CONSTRAINT "ledger_kind_delta_shape" CHECK ((
        ("loyalty"."ledger_entries"."kind" IN ('earn', 'adjust_credit') AND "loyalty"."ledger_entries"."delta_units" > 0)
        OR ("loyalty"."ledger_entries"."kind" IN ('redeem', 'adjust_debit', 'expire') AND "loyalty"."ledger_entries"."delta_units" < 0)
        OR "loyalty"."ledger_entries"."kind" = 'reverse'
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."member_profiles" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"tenant_ref" text NOT NULL,
	"encrypted_payload" text NOT NULL,
	"phone_lookup_hash" text,
	"key_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_profiles_key_version_positive" CHECK ("loyalty"."member_profiles"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty"."member_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "loyalty"."token_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "member_tokens_status_timestamp_shape" CHECK ((
        ("loyalty"."member_tokens"."status" = 'active' AND "loyalty"."member_tokens"."revoked_at" IS NULL)
        OR ("loyalty"."member_tokens"."status" = 'revoked' AND "loyalty"."member_tokens"."revoked_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"status" "loyalty"."member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "members_status_timestamps_shape" CHECK ((
        ("loyalty"."members"."status" = 'active' AND "loyalty"."members"."blocked_at" IS NULL AND "loyalty"."members"."anonymized_at" IS NULL)
        OR ("loyalty"."members"."status" = 'blocked' AND "loyalty"."members"."blocked_at" IS NOT NULL AND "loyalty"."members"."anonymized_at" IS NULL)
        OR ("loyalty"."members"."status" = 'anonymized' AND "loyalty"."members"."anonymized_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."membership_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" "loyalty"."membership_event_kind" NOT NULL,
	"terms_notice_version" text,
	"source" "loyalty"."ledger_source" NOT NULL,
	"actor_ref" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_events_terms_shape" CHECK ((
        ("loyalty"."membership_events"."kind" = 'joined' AND "loyalty"."membership_events"."terms_notice_version" IS NOT NULL)
        OR ("loyalty"."membership_events"."kind" <> 'joined' AND "loyalty"."membership_events"."terms_notice_version" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."operations" (
	"tenant_ref" text NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" "loyalty"."operation_kind" NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" "loyalty"."operation_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "operations_tenant_ref_operation_id_pk" PRIMARY KEY("tenant_ref","operation_id"),
	CONSTRAINT "operations_status_result_shape" CHECK ((
        ("loyalty"."operations"."status" = 'pending' AND "loyalty"."operations"."result" IS NULL AND "loyalty"."operations"."completed_at" IS NULL)
        OR ("loyalty"."operations"."status" = 'completed' AND "loyalty"."operations"."result" IS NOT NULL AND "loyalty"."operations"."completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."program_versions" (
	"tenant_ref" text NOT NULL,
	"program_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"mechanism" "loyalty"."mechanism" NOT NULL,
	"minimum_purchase_cents" integer DEFAULT 0 NOT NULL,
	"maximum_units_per_purchase" integer,
	"spend_step_cents" integer,
	"units_per_step" integer,
	"units_per_visit" integer,
	"unit_label_singular" text NOT NULL,
	"unit_label_plural" text NOT NULL,
	"terms_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_versions_program_id_version_pk" PRIMARY KEY("program_id","version"),
	CONSTRAINT "program_versions_version_positive" CHECK ("loyalty"."program_versions"."version" > 0),
	CONSTRAINT "program_versions_minimum_nonnegative" CHECK ("loyalty"."program_versions"."minimum_purchase_cents" >= 0),
	CONSTRAINT "program_versions_cap_positive" CHECK ("loyalty"."program_versions"."maximum_units_per_purchase" IS NULL OR "loyalty"."program_versions"."maximum_units_per_purchase" > 0),
	CONSTRAINT "program_versions_mechanism_shape" CHECK ((
        ("loyalty"."program_versions"."mechanism" = 'points' AND "loyalty"."program_versions"."spend_step_cents" > 0 AND "loyalty"."program_versions"."units_per_step" > 0 AND "loyalty"."program_versions"."units_per_visit" IS NULL)
        OR
        ("loyalty"."program_versions"."mechanism" = 'stamps' AND "loyalty"."program_versions"."units_per_visit" > 0 AND "loyalty"."program_versions"."spend_step_cents" IS NULL AND "loyalty"."program_versions"."units_per_step" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"status" "loyalty"."program_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_current_version_positive" CHECK ("loyalty"."programs"."current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty"."redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"reward_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"ledger_entry_id" uuid,
	"status" "loyalty"."redemption_status" NOT NULL,
	"reward_snapshot" jsonb NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "redemptions_status_timestamps_shape" CHECK ((
        ("loyalty"."redemptions"."status" = 'reserved' AND "loyalty"."redemptions"."ledger_entry_id" IS NULL AND "loyalty"."redemptions"."consumed_at" IS NULL AND "loyalty"."redemptions"."reversed_at" IS NULL AND "loyalty"."redemptions"."expires_at" IS NOT NULL)
        OR ("loyalty"."redemptions"."status" = 'consumed' AND "loyalty"."redemptions"."ledger_entry_id" IS NOT NULL AND "loyalty"."redemptions"."consumed_at" IS NOT NULL AND "loyalty"."redemptions"."reversed_at" IS NULL)
        OR ("loyalty"."redemptions"."status" = 'reversed' AND "loyalty"."redemptions"."ledger_entry_id" IS NOT NULL AND "loyalty"."redemptions"."consumed_at" IS NOT NULL AND "loyalty"."redemptions"."reversed_at" IS NOT NULL)
        OR ("loyalty"."redemptions"."status" = 'expired' AND "loyalty"."redemptions"."ledger_entry_id" IS NULL AND "loyalty"."redemptions"."consumed_at" IS NULL AND "loyalty"."redemptions"."reversed_at" IS NULL AND "loyalty"."redemptions"."expires_at" IS NOT NULL)
      )),
	CONSTRAINT "redemptions_timestamp_order" CHECK ((
        ("loyalty"."redemptions"."expires_at" IS NULL OR "loyalty"."redemptions"."expires_at" > "loyalty"."redemptions"."reserved_at")
        AND ("loyalty"."redemptions"."consumed_at" IS NULL OR "loyalty"."redemptions"."consumed_at" >= "loyalty"."redemptions"."reserved_at")
        AND ("loyalty"."redemptions"."reversed_at" IS NULL OR ("loyalty"."redemptions"."consumed_at" IS NOT NULL AND "loyalty"."redemptions"."reversed_at" >= "loyalty"."redemptions"."consumed_at"))
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cost_units" integer NOT NULL,
	"kind" "loyalty"."reward_kind" DEFAULT 'custom' NOT NULL,
	"value_cents" integer,
	"product_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rewards_cost_positive" CHECK ("loyalty"."rewards"."cost_units" > 0),
	CONSTRAINT "rewards_kind_shape" CHECK ((
        ("loyalty"."rewards"."kind" = 'custom' AND "loyalty"."rewards"."value_cents" IS NULL AND "loyalty"."rewards"."product_ref" IS NULL)
        OR ("loyalty"."rewards"."kind" = 'fixed_discount' AND "loyalty"."rewards"."value_cents" > 0 AND "loyalty"."rewards"."product_ref" IS NULL)
        OR ("loyalty"."rewards"."kind" = 'product' AND "loyalty"."rewards"."product_ref" IS NOT NULL AND "loyalty"."rewards"."value_cents" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "loyalty"."wallets" (
	"tenant_ref" text NOT NULL,
	"member_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"balance_units" integer DEFAULT 0 NOT NULL,
	"lifetime_earned_units" integer DEFAULT 0 NOT NULL,
	"lifetime_redeemed_units" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_tenant_ref_member_id_program_id_pk" PRIMARY KEY("tenant_ref","member_id","program_id"),
	CONSTRAINT "wallets_balance_nonnegative" CHECK ("loyalty"."wallets"."balance_units" >= 0),
	CONSTRAINT "wallets_lifetime_earned_nonnegative" CHECK ("loyalty"."wallets"."lifetime_earned_units" >= 0),
	CONSTRAINT "wallets_lifetime_redeemed_nonnegative" CHECK ("loyalty"."wallets"."lifetime_redeemed_units" >= 0),
	CONSTRAINT "wallets_version_nonnegative" CHECK ("loyalty"."wallets"."version" >= 0)
);
--> statement-breakpoint
-- PostgreSQL exige que les cibles composites soient uniques AVANT d'ajouter
-- les clés étrangères qui les référencent. Drizzle émet sinon ces index trop tard.
CREATE UNIQUE INDEX "members_tenant_id_uq" ON "loyalty"."members" USING btree ("tenant_ref","id");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_tenant_id_uq" ON "loyalty"."programs" USING btree ("tenant_ref","id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_versions_tenant_identity_uq" ON "loyalty"."program_versions" USING btree ("tenant_ref","program_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_tenant_program_id_uq" ON "loyalty"."rewards" USING btree ("tenant_ref","program_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tenant_member_program_id_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","member_id","program_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_events_tenant_identity_uq" ON "loyalty"."consent_events" USING btree ("tenant_ref","id","member_id","purpose","decision","notice_version");--> statement-breakpoint
ALTER TABLE "loyalty"."consent_events" ADD CONSTRAINT "consent_events_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."consent_events" ADD CONSTRAINT "consent_events_tenant_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."consent_state" ADD CONSTRAINT "consent_state_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."consent_state" ADD CONSTRAINT "consent_state_tenant_event_fk" FOREIGN KEY ("tenant_ref","event_id","member_id","purpose","decision","notice_version") REFERENCES "loyalty"."consent_events"("tenant_ref","id","member_id","purpose","decision","notice_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_tenant_program_fk" FOREIGN KEY ("tenant_ref","program_id") REFERENCES "loyalty"."programs"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_tenant_program_rules_fk" FOREIGN KEY ("tenant_ref","program_id","rules_version") REFERENCES "loyalty"."program_versions"("tenant_ref","program_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_tenant_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_reversal_origin_fk" FOREIGN KEY ("tenant_ref","member_id","program_id","reversed_entry_id") REFERENCES "loyalty"."ledger_entries"("tenant_ref","member_id","program_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."member_profiles" ADD CONSTRAINT "member_profiles_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."member_tokens" ADD CONSTRAINT "member_tokens_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" ADD CONSTRAINT "membership_events_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" ADD CONSTRAINT "membership_events_tenant_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."program_versions" ADD CONSTRAINT "program_versions_tenant_program_fk" FOREIGN KEY ("tenant_ref","program_id") REFERENCES "loyalty"."programs"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."redemptions" ADD CONSTRAINT "redemptions_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."redemptions" ADD CONSTRAINT "redemptions_tenant_reward_fk" FOREIGN KEY ("tenant_ref","program_id","reward_id") REFERENCES "loyalty"."rewards"("tenant_ref","program_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."redemptions" ADD CONSTRAINT "redemptions_tenant_ledger_fk" FOREIGN KEY ("tenant_ref","member_id","program_id","ledger_entry_id") REFERENCES "loyalty"."ledger_entries"("tenant_ref","member_id","program_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."redemptions" ADD CONSTRAINT "redemptions_tenant_operation_fk" FOREIGN KEY ("tenant_ref","operation_id") REFERENCES "loyalty"."operations"("tenant_ref","operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."rewards" ADD CONSTRAINT "rewards_tenant_program_fk" FOREIGN KEY ("tenant_ref","program_id") REFERENCES "loyalty"."programs"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_tenant_member_fk" FOREIGN KEY ("tenant_ref","member_id") REFERENCES "loyalty"."members"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_tenant_program_fk" FOREIGN KEY ("tenant_ref","program_id") REFERENCES "loyalty"."programs"("tenant_ref","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_events_tenant_operation_uq" ON "loyalty"."consent_events" USING btree ("tenant_ref","operation_id");--> statement-breakpoint
CREATE INDEX "consent_events_member_history_idx" ON "loyalty"."consent_events" USING btree ("tenant_ref","member_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tenant_operation_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tenant_id_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_wallet_version_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","member_id","program_id","wallet_version");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_reversed_entry_uq" ON "loyalty"."ledger_entries" USING btree ("reversed_entry_id") WHERE "loyalty"."ledger_entries"."reversed_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_member_history_idx" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","member_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "ledger_external_ref_idx" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_tenant_phone_uq" ON "loyalty"."member_profiles" USING btree ("tenant_ref","phone_lookup_hash") WHERE "loyalty"."member_profiles"."phone_lookup_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "member_tokens_hash_uq" ON "loyalty"."member_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "member_tokens_tenant_member_idx" ON "loyalty"."member_tokens" USING btree ("tenant_ref","member_id");--> statement-breakpoint
CREATE INDEX "members_tenant_activity_idx" ON "loyalty"."members" USING btree ("tenant_ref","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_events_tenant_operation_uq" ON "loyalty"."membership_events" USING btree ("tenant_ref","operation_id");--> statement-breakpoint
CREATE INDEX "membership_events_member_history_idx" ON "loyalty"."membership_events" USING btree ("tenant_ref","member_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "programs_tenant_uq" ON "loyalty"."programs" USING btree ("tenant_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "redemptions_tenant_operation_uq" ON "loyalty"."redemptions" USING btree ("tenant_ref","operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "redemptions_ledger_uq" ON "loyalty"."redemptions" USING btree ("ledger_entry_id") WHERE "loyalty"."redemptions"."ledger_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "redemptions_tenant_member_idx" ON "loyalty"."redemptions" USING btree ("tenant_ref","member_id","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_tenant_id_uq" ON "loyalty"."rewards" USING btree ("tenant_ref","id");--> statement-breakpoint
CREATE INDEX "rewards_tenant_program_idx" ON "loyalty"."rewards" USING btree ("tenant_ref","program_id","active");--> statement-breakpoint

-- La version publiée doit exister à la fin de la transaction. La contrainte
-- différée permet la création atomique programme + version 1 malgré le cycle.
ALTER TABLE "loyalty"."programs"
  ADD CONSTRAINT "programs_current_version_fk"
  FOREIGN KEY ("tenant_ref", "id", "current_version")
  REFERENCES "loyalty"."program_versions" ("tenant_ref", "program_id", "version")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- Les preuves réglementaires et financières sont append-only. Toute correction
-- crée un nouvel événement ; elle ne réécrit jamais le passé.
CREATE FUNCTION "loyalty"."reject_immutable_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'la table %.% est append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."reject_immutable_event"();--> statement-breakpoint
CREATE TRIGGER "program_versions_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty"."program_versions"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."reject_immutable_event"();--> statement-breakpoint
CREATE TRIGGER "consent_events_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty"."consent_events"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."reject_immutable_event"();--> statement-breakpoint
CREATE TRIGGER "membership_events_append_only"
  BEFORE UPDATE OR DELETE ON "loyalty"."membership_events"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."reject_immutable_event"();--> statement-breakpoint

-- Un ledger ne peut jamais raconter un autre solde que la projection wallet,
-- sauter une version, ni compenser un montant différent de l'origine.
CREATE FUNCTION "loyalty"."validate_ledger_append"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_balance integer;
  current_wallet_version integer;
  previous_balance integer := 0;
  origin_delta integer;
BEGIN
  SELECT "balance_units", "version"
    INTO current_balance, current_wallet_version
    FROM "loyalty"."wallets"
    WHERE "tenant_ref" = NEW."tenant_ref"
      AND "member_id" = NEW."member_id"
      AND "program_id" = NEW."program_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet fidélité introuvable pour le ledger'
      USING ERRCODE = '23503';
  END IF;

  IF current_balance <> NEW."balance_after"
     OR current_wallet_version <> NEW."wallet_version" THEN
    RAISE EXCEPTION 'ledger et wallet fidélité incohérents'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."wallet_version" > 1 THEN
    SELECT "balance_after"
      INTO previous_balance
      FROM "loyalty"."ledger_entries"
      WHERE "tenant_ref" = NEW."tenant_ref"
        AND "member_id" = NEW."member_id"
        AND "program_id" = NEW."program_id"
        AND "wallet_version" = NEW."wallet_version" - 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'version précédente du ledger fidélité absente'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF previous_balance + NEW."delta_units" <> NEW."balance_after" THEN
    RAISE EXCEPTION 'delta du ledger fidélité incohérent avec son solde'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'reverse' THEN
    SELECT "delta_units"
      INTO origin_delta
      FROM "loyalty"."ledger_entries"
      WHERE "tenant_ref" = NEW."tenant_ref"
        AND "member_id" = NEW."member_id"
        AND "program_id" = NEW."program_id"
        AND "id" = NEW."reversed_entry_id";
    IF NOT FOUND OR NEW."delta_units" <> -origin_delta THEN
      RAISE EXCEPTION 'une compensation doit inverser exactement son origine'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "ledger_entries_validate_append"
  BEFORE INSERT ON "loyalty"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "loyalty"."validate_ledger_append"();--> statement-breakpoint

-- Défense en profondeur multi-tenant. L'API doit exécuter
-- set_config('app.tenant_ref', tenant, true) au début de CHAQUE transaction.
DO $$
DECLARE
  scoped_table text;
BEGIN
  FOREACH scoped_table IN ARRAY ARRAY[
    'programs', 'program_versions', 'rewards', 'members', 'member_profiles',
    'member_tokens', 'wallets', 'operations', 'ledger_entries', 'redemptions',
    'consent_events', 'consent_state', 'membership_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE loyalty.%I ENABLE ROW LEVEL SECURITY', scoped_table);
    EXECUTE format('ALTER TABLE loyalty.%I FORCE ROW LEVEL SECURITY', scoped_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON loyalty.%I USING (tenant_ref = current_setting(''app.tenant_ref'', true)) WITH CHECK (tenant_ref = current_setting(''app.tenant_ref'', true))',
      scoped_table
    );
  END LOOP;
END;
$$;
