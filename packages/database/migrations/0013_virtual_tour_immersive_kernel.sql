CREATE TABLE "virtual_tours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"provider" text NOT NULL,
	"provider_asset_id" text NOT NULL,
	"internal_name" text NOT NULL,
	"public_name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "virtual_tours_ordering_nonneg_ck" CHECK ("virtual_tours"."ordering" >= 0),
	CONSTRAINT "virtual_tours_provider_asset_id_nonempty_ck" CHECK (length("virtual_tours"."provider_asset_id") > 0)
);
--> statement-breakpoint
ALTER TABLE "virtual_tours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual_tours" ADD CONSTRAINT "virtual_tours_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_tours" ADD CONSTRAINT "virtual_tours_tenant_property_fk" FOREIGN KEY ("tenant_id","property_id") REFERENCES "public"."properties"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "units_tenant_property_id_uidx" ON "units" USING btree ("tenant_id","property_id","id");--> statement-breakpoint
ALTER TABLE "virtual_tours" ADD CONSTRAINT "virtual_tours_tenant_property_unit_fk" FOREIGN KEY ("tenant_id","property_id","unit_id") REFERENCES "public"."units"("tenant_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_tours_tenant_id_id_uidx" ON "virtual_tours" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "virtual_tours_tenant_id_idx" ON "virtual_tours" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "virtual_tours_property_id_idx" ON "virtual_tours" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "virtual_tours_unit_id_idx" ON "virtual_tours" USING btree ("unit_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation_virtual_tours" ON "virtual_tours" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);