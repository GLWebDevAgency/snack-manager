ALTER TABLE "ingredients" ADD COLUMN "removable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "supplement_price_cents" integer;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "display_name" text;