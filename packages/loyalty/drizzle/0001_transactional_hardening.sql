ALTER TABLE "loyalty"."ledger_entries" ALTER COLUMN "delta_units" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ALTER COLUMN "balance_after" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ALTER COLUMN "rules_version" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ALTER COLUMN "wallet_version" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."program_versions" ALTER COLUMN "version" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."programs" ALTER COLUMN "current_version" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."programs" ALTER COLUMN "current_version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ALTER COLUMN "balance_units" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ALTER COLUMN "lifetime_earned_units" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ALTER COLUMN "lifetime_redeemed_units" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ALTER COLUMN "version" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "loyalty"."redemptions" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_earn_external_ref_uq" ON "loyalty"."ledger_entries" USING btree ("tenant_ref","source","external_ref") WHERE "loyalty"."ledger_entries"."kind" = 'earn' AND "loyalty"."ledger_entries"."external_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_delta_safe_integer" CHECK ("loyalty"."ledger_entries"."delta_units" BETWEEN -9007199254740991 AND 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_balance_safe_integer" CHECK ("loyalty"."ledger_entries"."balance_after" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_rules_version_safe_integer" CHECK ("loyalty"."ledger_entries"."rules_version" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."ledger_entries" ADD CONSTRAINT "ledger_wallet_version_safe_integer" CHECK ("loyalty"."ledger_entries"."wallet_version" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."program_versions" ADD CONSTRAINT "program_versions_version_safe_integer" CHECK ("loyalty"."program_versions"."version" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."programs" ADD CONSTRAINT "programs_current_version_safe_integer" CHECK ("loyalty"."programs"."current_version" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_balance_safe_integer" CHECK ("loyalty"."wallets"."balance_units" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_lifetime_earned_safe_integer" CHECK ("loyalty"."wallets"."lifetime_earned_units" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_lifetime_redeemed_safe_integer" CHECK ("loyalty"."wallets"."lifetime_redeemed_units" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."wallets" ADD CONSTRAINT "wallets_version_safe_integer" CHECK ("loyalty"."wallets"."version" <= 9007199254740991);--> statement-breakpoint

-- Les colonnes monétaires de fidélité sont désormais BIGINT. La fonction de
-- validation doit utiliser le même domaine pour ne jamais reconvertir un
-- solde valide vers INTEGER au moment critique de l'append du ledger.
CREATE OR REPLACE FUNCTION "loyalty"."validate_ledger_append"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_balance bigint;
  current_wallet_version bigint;
  previous_balance bigint := 0;
  origin_delta bigint;
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
$$;
