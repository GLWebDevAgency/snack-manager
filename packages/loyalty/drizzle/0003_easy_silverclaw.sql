ALTER TYPE "loyalty"."membership_event_kind" ADD VALUE 'token_replaced';--> statement-breakpoint
ALTER TYPE "loyalty"."operation_kind" ADD VALUE 'member_lifecycle' BEFORE 'reservation';--> statement-breakpoint
ALTER TYPE "loyalty"."operation_kind" ADD VALUE 'token_replace' BEFORE 'reservation';--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" DROP CONSTRAINT "membership_events_terms_shape";--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "loyalty"."membership_events" ADD CONSTRAINT "membership_events_terms_shape" CHECK ((
        ("loyalty"."membership_events"."kind" = 'joined' AND "loyalty"."membership_events"."terms_notice_version" IS NOT NULL AND "loyalty"."membership_events"."reason" IS NULL)
        OR (
          "loyalty"."membership_events"."kind" <> 'joined'
          AND "loyalty"."membership_events"."terms_notice_version" IS NULL
          AND length(trim("loyalty"."membership_events"."reason")) BETWEEN 3 AND 300
        )
      ));