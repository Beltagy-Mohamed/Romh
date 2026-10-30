-- 0005: دور تطبيق مقيد — RLS لا يُطبَّق على مالك الجداول، لذا يتصل الخادم بدور غير مالك.
-- القاعدة: مالك الجداول bypassrls؛ تطبيق الـ API يتصل بـ fazaa_app.
-- idempotent: يُنشأ الدور فقط إن لم يوجد.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fazaa_app') THEN
    EXECUTE 'CREATE ROLE fazaa_app LOGIN PASSWORD ''fazaa_app_dev'''; -- dev فقط؛ الإنتاج عبر secret manager
  END IF;
END$$;
GRANT USAGE ON SCHEMA public TO fazaa_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO fazaa_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO fazaa_app;
-- audit_log يُكتب فقط (append-only):
REVOKE UPDATE, DELETE ON audit_log FROM fazaa_app;
