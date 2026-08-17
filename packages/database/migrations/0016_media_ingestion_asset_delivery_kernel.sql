CREATE TABLE "media_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"max_bytes" integer NOT NULL,
	"declared_mime_type" text,
	"original_filename" text,
	"media_asset_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "media_uploads_max_bytes_positive_ck" CHECK ("media_uploads"."max_bytes" > 0),
	CONSTRAINT "media_uploads_finalized_has_asset_ck" CHECK (("media_uploads"."status" = 'finalized') = ("media_uploads"."media_asset_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "media_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "checksum_sha256" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "byte_size" integer;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "variants" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_tenant_media_asset_fk" FOREIGN KEY ("tenant_id","media_asset_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_uploads_tenant_storage_key_uidx" ON "media_uploads" USING btree ("tenant_id","storage_key");--> statement-breakpoint
CREATE INDEX "media_uploads_tenant_id_idx" ON "media_uploads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "media_uploads_status_expires_at_idx" ON "media_uploads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation_media_uploads" ON "media_uploads" AS PERMISSIVE FOR ALL TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);