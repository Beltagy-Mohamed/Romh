-- 0009: دور النظام يقرأ/يضيف السجل (الأدوات الإدارية والتحقق)
DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (
  app_is_system() OR approver_id IS NOT NULL OR actor_id IS NOT NULL
);
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log FOR SELECT USING (
  is_super_admin() OR app_is_system()
);
