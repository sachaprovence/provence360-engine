CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"category" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amenities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"internal_name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"page_type" text DEFAULT 'standard' NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_content_is_array_ck" CHECK (jsonb_typeof("pages"."content") = 'array')
);
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"internal_name" text NOT NULL,
	"public_name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"property_type" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"address_city" text,
	"address_postal_code" text,
	"address_region" text,
	"address_country" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"timezone" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "themes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "unit_amenities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_amenities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"internal_name" text NOT NULL,
	"public_name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"max_guests" integer,
	"bedrooms" integer,
	"beds" integer,
	"bathrooms" numeric(3, 1),
	"size" numeric(8, 2),
	"size_unit" text,
	"description" text,
	"ordering" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_size_requires_unit_ck" CHECK (("units"."size" is null and "units"."size_unit" is null) or ("units"."size" is not null and "units"."size_unit" is not null))
);
--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "public_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "timezone" text DEFAULT 'Europe/Paris' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "default_locale" text DEFAULT 'fr' NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "enabled_locales" jsonb DEFAULT '["fr"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "theme_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "theme_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "navigation" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "features" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- These three composite-FK targets are created here, ahead of the
-- ALTER TABLE ... ADD CONSTRAINT block below, because a foreign key
-- referencing (tenant_id, id) requires that pair's unique index to
-- already exist — drizzle-kit generates index creation later in the file
-- by default, which is too late for a same-migration composite FK target.
CREATE UNIQUE INDEX "sites_tenant_id_id_uidx" ON "sites" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_tenant_id_id_uidx" ON "properties" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_tenant_id_id_uidx" ON "units" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_tenant_unit_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_property_fk" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "amenities_key_uidx" ON "amenities" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_tenant_storage_key_uidx" ON "media_assets" USING btree ("tenant_id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_tenant_id_id_uidx" ON "media_assets" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "media_assets_tenant_id_idx" ON "media_assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_site_slug_uidx" ON "pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_site_home_uidx" ON "pages" USING btree ("site_id") WHERE page_type = 'home';--> statement-breakpoint
CREATE INDEX "pages_tenant_id_idx" ON "pages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pages_site_id_idx" ON "pages" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_site_slug_uidx" ON "properties" USING btree ("site_id","slug");--> statement-breakpoint
CREATE INDEX "properties_tenant_id_idx" ON "properties" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "properties_site_id_idx" ON "properties" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "themes_key_uidx" ON "themes" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_amenities_unit_amenity_uidx" ON "unit_amenities" USING btree ("unit_id","amenity_id");--> statement-breakpoint
CREATE INDEX "unit_amenities_tenant_id_idx" ON "unit_amenities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "unit_amenities_unit_id_idx" ON "unit_amenities" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_property_slug_uidx" ON "units" USING btree ("property_id","slug");--> statement-breakpoint
CREATE INDEX "units_tenant_id_idx" ON "units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "units_property_id_idx" ON "units" USING btree ("property_id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "read_amenities" ON "amenities" AS PERMISSIVE FOR SELECT TO "provence360_app" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation_media_assets" ON "media_assets" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_pages" ON "pages" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_properties" ON "properties" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "read_themes" ON "themes" AS PERMISSIVE FOR SELECT TO "provence360_app" USING (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation_unit_amenities" ON "unit_amenities" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_units" ON "units" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);