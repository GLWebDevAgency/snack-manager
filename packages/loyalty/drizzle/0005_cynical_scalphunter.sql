ALTER TABLE "loyalty"."members" ADD COLUMN "enrollment_handoff_at" timestamp with time zone;--> statement-breakpoint
UPDATE "loyalty"."members"
SET "enrollment_handoff_at" = "joined_at"
WHERE "enrollment_handoff_at" IS NULL;--> statement-breakpoint
-- Le protocole précédent ne persistait ni propriétaire de reprise ni date de
-- remise. Toute opération antérieure est donc fermée explicitement au cutover :
-- les cartes historiques restent actives grâce au backfill ci-dessus, mais un
-- ancien UUID ne peut ni régénérer un QR ni provoquer une erreur de parsing.
UPDATE "loyalty"."operations"
SET "request_fingerprint" = repeat('0', 64),
    "status" = 'completed',
    "result" = jsonb_build_object('enrollmentCutoverClosed', true),
    "completed_at" = COALESCE("completed_at", now())
WHERE "kind" = 'member_create';--> statement-breakpoint
CREATE INDEX "members_unhanded_enrollment_idx" ON "loyalty"."members" USING btree ("tenant_ref","joined_at") WHERE "loyalty"."members"."enrollment_handoff_at" IS NULL;--> statement-breakpoint
ALTER TABLE "loyalty"."members" ADD CONSTRAINT "members_enrollment_handoff_after_joined" CHECK ("loyalty"."members"."enrollment_handoff_at" IS NULL OR "loyalty"."members"."enrollment_handoff_at" >= "loyalty"."members"."joined_at");
