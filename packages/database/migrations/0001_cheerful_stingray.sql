ALTER POLICY "tenant_read_audit_logs" ON "audit_logs" TO provence360_app USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_insert_audit_logs" ON "audit_logs" TO provence360_app WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_isolation_domains" ON "domains" TO provence360_app USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_isolation_memberships" ON "memberships" TO provence360_app USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_isolation_sites" ON "sites" TO provence360_app USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_isolation_tenants" ON "tenants" TO provence360_app USING (id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "tenant_visible_users" ON "users" TO provence360_app USING (exists (
        select 1 from memberships m
        where m.user_id = users.id
          and m.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      ));