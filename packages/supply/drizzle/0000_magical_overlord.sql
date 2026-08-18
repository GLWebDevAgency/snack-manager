CREATE TYPE "public"."allergen" AS ENUM('gluten', 'crustaces', 'oeufs', 'poissons', 'arachides', 'soja', 'lait', 'fruits_a_coque', 'celeri', 'moutarde', 'sesame', 'sulfites', 'lupin', 'mollusques');--> statement-breakpoint
CREATE TYPE "public"."base_unit" AS ENUM('kg', 'l', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('viande', 'volaille', 'poisson', 'fromage', 'legume', 'feculent', 'pain', 'sauce', 'epicerie', 'dessert', 'boisson', 'emballage', 'autre');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('a_payer', 'payee', 'litige');--> statement-breakpoint
CREATE TYPE "public"."measure_unit" AS ENUM('g', 'kg', 'ml', 'l', 'pcs');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('purchase', 'sale', 'waste', 'count');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('draft', 'sent', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."storage" AS ENUM('sec', 'frais', 'congele');--> statement-breakpoint
CREATE TABLE "ingredient_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"preferred" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text,
	"canonical_id" uuid,
	"name" text NOT NULL,
	"category" "ingredient_category" DEFAULT 'autre' NOT NULL,
	"unit" "base_unit" DEFAULT 'kg' NOT NULL,
	"allergens" "allergen"[] DEFAULT '{}' NOT NULL,
	"cost_per_unit_cents" integer DEFAULT 0 NOT NULL,
	"current_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"par_level" numeric(12, 3) DEFAULT '0' NOT NULL,
	"storage" "storage" DEFAULT 'sec' NOT NULL,
	"is_out" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"number" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"total_ht_cents" integer DEFAULT 0 NOT NULL,
	"tva_cents" integer DEFAULT 0 NOT NULL,
	"total_ttc_cents" integer DEFAULT 0 NOT NULL,
	"status" "invoice_status" DEFAULT 'a_payer' NOT NULL,
	"file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"product_ref" text NOT NULL,
	"group_key" text NOT NULL,
	"choice_key" text NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit" "measure_unit" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_item_id" uuid NOT NULL,
	"qty_packs" numeric(12, 3) NOT NULL,
	"pack_price_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "po_status" DEFAULT 'draft' NOT NULL,
	"expected_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"unit" "measure_unit" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"product_ref" text NOT NULL,
	"variant_key" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"ref" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"brand_id" uuid,
	"sku" text,
	"pack_qty" numeric(12, 3) NOT NULL,
	"pack_price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_item_id" uuid NOT NULL,
	"pack_price_cents" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_ref" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"payment_terms" text,
	"delivery_days" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_brands" ADD CONSTRAINT "ingredient_brands_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_ingredients" ADD CONSTRAINT "option_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_item_id_supplier_items_id_fk" FOREIGN KEY ("supplier_item_id") REFERENCES "public"."supplier_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_brand_id_ingredient_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."ingredient_brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_price_history" ADD CONSTRAINT "supplier_price_history_supplier_item_id_supplier_items_id_fk" FOREIGN KEY ("supplier_item_id") REFERENCES "public"."supplier_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brands_ingredient_idx" ON "ingredient_brands" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "ingredients_tenant_idx" ON "ingredients" USING btree ("tenant_ref");--> statement-breakpoint
CREATE INDEX "ingredients_canonical_idx" ON "ingredients" USING btree ("canonical_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingredients_tenant_name_uq" ON "ingredients" USING btree ("tenant_ref","name");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_ref","status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_number_uq" ON "invoices" USING btree ("supplier_id","number");--> statement-breakpoint
CREATE INDEX "option_ing_product_idx" ON "option_ingredients" USING btree ("tenant_ref","product_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "option_ing_scope_uq" ON "option_ingredients" USING btree ("tenant_ref","product_ref","group_key","choice_key","ingredient_id");--> statement-breakpoint
CREATE INDEX "po_lines_po_idx" ON "purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "po_tenant_idx" ON "purchase_orders" USING btree ("tenant_ref","status");--> statement-breakpoint
CREATE INDEX "recipe_lines_recipe_idx" ON "recipe_lines" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_lines_ingredient_idx" ON "recipe_lines" USING btree ("ingredient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_scope_uq" ON "recipes" USING btree ("tenant_ref","product_ref","variant_key");--> statement-breakpoint
CREATE INDEX "recipes_product_idx" ON "recipes" USING btree ("product_ref");--> statement-breakpoint
CREATE INDEX "movements_tenant_ing_idx" ON "stock_movements" USING btree ("tenant_ref","ingredient_id","at");--> statement-breakpoint
CREATE INDEX "supplier_items_supplier_idx" ON "supplier_items" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_items_ingredient_idx" ON "supplier_items" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "price_history_item_idx" ON "supplier_price_history" USING btree ("supplier_item_id","recorded_at");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_ref");