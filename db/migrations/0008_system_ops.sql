-- 0008: سياسات system لجداول مسار البلاغ (الخادم الموثوق يكتب الدوائر/الأحداث تلقائيًا).
-- ملاحظة معمارية: الخصوصية الحساسة تُفرض بقوائم أعمدة في API (D-004) + RLS لمسارات المستخدم.
DROP POLICY IF EXISTS incidents_insert_system ON incidents;
CREATE POLICY incidents_insert_system ON incidents FOR INSERT
  WITH CHECK (app_is_system() OR requester_id = app_current_user());
DROP POLICY IF EXISTS incidents_update_system ON incidents;
CREATE POLICY incidents_update_system ON incidents FOR UPDATE
  USING (app_is_system()) WITH CHECK (app_is_system());

DROP POLICY IF EXISTS incidents_read ON incidents;
CREATE POLICY incidents_read ON incidents FOR SELECT USING (app_is_system());

DROP POLICY IF EXISTS live_insert_system ON live_locations;
CREATE POLICY live_insert_system ON live_locations FOR INSERT
  WITH CHECK (app_is_system() OR user_id = app_current_user());
