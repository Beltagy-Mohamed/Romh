-- 0007: دور النظام للخادم + سياسات INSERT.
-- معماريًا: عمليات الخادم الموثوقة (تسجيل، محرك الدوائر، الإشعارات) تعمل بدور 'system'.
-- متصل المستخدم العادي يظل مقيدًا بالسياسات (D-004)، وسياسة الإخفاء على مستوى الأعمدة في الـ API.
CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_current_role() = 'system' $$;

-- users: التسجيل فقط عبر الخادم
DROP POLICY IF EXISTS users_insert_system ON users;
CREATE POLICY users_insert_system ON users FOR INSERT
  WITH CHECK (app_is_system());
DROP POLICY IF EXISTS users_update_system ON users;
CREATE POLICY users_update_system ON users FOR UPDATE
  USING (app_is_system()) WITH CHECK (app_is_system());

-- إعادة صياغة سياسات القراءة لتسمح للنظام (سجل حرجة — التنفيذ الحي يعتمد عليه)
DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users FOR SELECT USING (
  id = app_current_user()
  OR app_has_role('super_admin')
  OR house_id = app_my_house()
  OR app_is_system()
);
