CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "auth_insert_audit_logs" ON "audit_logs" AS PERMISSIVE FOR INSERT TO "provence360_auth" WITH CHECK (tenant_id is null);--> statement-breakpoint
CREATE POLICY "auth_read_audit_logs" ON "audit_logs" AS PERMISSIVE FOR SELECT TO "provence360_auth" USING (tenant_id is null);--> statement-breakpoint
CREATE POLICY "auth_read_memberships" ON "memberships" AS PERMISSIVE FOR SELECT TO "provence360_auth" USING (true);--> statement-breakpoint
CREATE POLICY "auth_read_tenants" ON "tenants" AS PERMISSIVE FOR SELECT TO "provence360_auth" USING (true);--> statement-breakpoint
CREATE POLICY "auth_lookup_users" ON "users" AS PERMISSIVE FOR SELECT TO "provence360_auth" USING (true);--> statement-breakpoint
CREATE POLICY "auth_update_users" ON "users" AS PERMISSIVE FOR UPDATE TO "provence360_auth" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "auth_manage_sessions" ON "sessions" AS PERMISSIVE FOR ALL TO "provence360_auth" USING (true) WITH CHECK (true);