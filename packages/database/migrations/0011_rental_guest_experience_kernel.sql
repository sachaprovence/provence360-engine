CREATE TABLE "property_amenities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_amenities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unit_sleeping_arrangements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"room_label" text,
	"bed_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_sleeping_arrangements_quantity_positive_ck" CHECK ("unit_sleeping_arrangements"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "unit_sleeping_arrangements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "check_in_time" time;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "check_out_time" time;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "quiet_hours_start" time;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "quiet_hours_end" time;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "smoking_policy" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "pets_policy" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "events_policy" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "location_disclosure" text DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_amenities" ADD CONSTRAINT "property_amenities_tenant_property_fk" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sleeping_arrangements" ADD CONSTRAINT "unit_sleeping_arrangements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_sleeping_arrangements" ADD CONSTRAINT "unit_sleeping_arrangements_tenant_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_amenities_property_amenity_uidx" ON "property_amenities" USING btree ("property_id","amenity_id");--> statement-breakpoint
CREATE INDEX "property_amenities_tenant_id_idx" ON "property_amenities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "property_amenities_property_id_idx" ON "property_amenities" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_sleeping_arrangements_tenant_id_id_uidx" ON "unit_sleeping_arrangements" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "unit_sleeping_arrangements_tenant_id_idx" ON "unit_sleeping_arrangements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "unit_sleeping_arrangements_unit_id_idx" ON "unit_sleeping_arrangements" USING btree ("unit_id");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_quiet_hours_pair_ck" CHECK (("properties"."quiet_hours_start" is null and "properties"."quiet_hours_end" is null) or ("properties"."quiet_hours_start" is not null and "properties"."quiet_hours_end" is not null));--> statement-breakpoint
CREATE POLICY "tenant_isolation_property_amenities" ON "property_amenities" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_unit_sleeping_arrangements" ON "unit_sleeping_arrangements" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);