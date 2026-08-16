CREATE TABLE "site_publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"previous_revision_id" uuid,
	"action" text NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_publications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_revisions_number_positive_ck" CHECK ("site_revisions"."revision_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "site_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "published_revision_id" uuid;--> statement-breakpoint
-- site_revisions' own FKs and its (tenant_id, id) unique index must exist
-- BEFORE site_publications' composite FKs below, which reference that
-- unique index as their target — Postgres requires a unique constraint/index
-- on the referenced columns to already exist when a composite FK is added.
ALTER TABLE "site_revisions" ADD CONSTRAINT "site_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_revisions" ADD CONSTRAINT "site_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_revisions" ADD CONSTRAINT "site_revisions_tenant_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_revisions_site_number_uidx" ON "site_revisions" USING btree ("site_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "site_revisions_tenant_id_id_uidx" ON "site_revisions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "site_revisions_tenant_id_idx" ON "site_revisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_revisions_site_id_number_idx" ON "site_revisions" USING btree ("site_id","revision_number");--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_tenant_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."sites"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_tenant_revision_fk" FOREIGN KEY ("tenant_id","revision_id") REFERENCES "public"."site_revisions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_publications" ADD CONSTRAINT "site_publications_tenant_previous_revision_fk" FOREIGN KEY ("tenant_id","previous_revision_id") REFERENCES "public"."site_revisions"("tenant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_publications_tenant_id_idx" ON "site_publications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "site_publications_site_id_created_idx" ON "site_publications" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_read_site_publications" ON "site_publications" AS PERMISSIVE FOR SELECT TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert_site_publications" ON "site_publications" AS PERMISSIVE FOR INSERT TO "provence360_app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read_site_revisions" ON "site_revisions" AS PERMISSIVE FOR SELECT TO "provence360_app" USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert_site_revisions" ON "site_revisions" AS PERMISSIVE FOR INSERT TO "provence360_app" WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
