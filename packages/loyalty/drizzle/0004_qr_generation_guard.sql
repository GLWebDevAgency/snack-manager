ALTER TABLE "loyalty"."membership_events" DROP CONSTRAINT "membership_events_terms_shape";--> statement-breakpoint
ALTER TABLE "loyalty"."members" ADD COLUMN "qr_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "member_tokens_one_active_uq" ON "loyalty"."member_tokens" USING btree ("tenant_ref","member_id") WHERE "loyalty"."member_tokens"."status" = 'active';--> statement-breakpoint
ALTER TABLE "loyalty"."members" ADD CONSTRAINT "members_qr_generation_positive" CHECK ("loyalty"."members"."qr_generation" > 0);--> statement-breakpoint
ALTER TABLE "loyalty"."members" ADD CONSTRAINT "members_qr_generation_safe_integer" CHECK ("loyalty"."members"."qr_generation" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" ADD CONSTRAINT "membership_events_terms_shape" CHECK ((
        ("loyalty"."membership_events"."kind" = 'joined' AND "loyalty"."membership_events"."terms_notice_version" IS NOT NULL AND "loyalty"."membership_events"."reason" IS NULL)
        OR (
          "loyalty"."membership_events"."kind" <> 'joined'
          AND "loyalty"."membership_events"."terms_notice_version" IS NULL
          AND "loyalty"."membership_events"."reason" IS NOT NULL
          AND length(trim("loyalty"."membership_events"."reason")) BETWEEN 3 AND 300
        )
      ));