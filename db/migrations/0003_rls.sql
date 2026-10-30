-- 0003: Row-Level Security — طبقة الخصوصية الثانية (D-004)
-- الخادم يفتح كل اتصال بمستخدم قاعدة بلا صلاحية bypassrls ثم يضبط:
--   SELECT set_config('app.user_id', '<uuid>', true), ('app.role','member'|'super_admin', true);
-- هذه طبقة دفاع تحت الـ API وليست بديلًا عنه.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('app.role', true), ''), 'anon') $$;
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT app_current_role() = 'super_admin' $$;

-- حوار: أداة العضوية = هل يوجد responsive صف en_route/arrived للمستخدم في هذا البلاغ؟
-- (تعريف القسم 11: صلاحية الموقع الدقيق = وجود صف en_route/arrived)
CREATE OR REPLACE FUNCTION is_committed_responder(p_incident uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM incident_responses
    WHERE incident_id = p_incident
      AND user_id = app_current_user()
      AND status IN ('en_route','arrived')
  )
$$;

-- 1) البلاغات: الغير ملتزم يرى صفاها دون الإحداثيات الدقيقة؛ الملتزم والأدمن ببيته يروها أثناء النشاط.
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incidents_select ON incidents;
CREATE POLICY incidents_select ON incidents FOR SELECT USING (
  requester_id = app_current_user()
  OR is_committed_responder(id)
  OR (is_super_admin())                                       -- بلا مواقع في الـ API (تصفية أعمدة)
  OR EXISTS (SELECT 1 FROM users u
             WHERE u.id = app_current_user() AND u.house_id = incidents.house_id)
);
-- ملاحظة: أعضاء البيت يرون صف البلاغ، لكن exact_location تُمنع على مستوى الأعمدة بعرض منفصل أدناه.

DROP POLICY IF EXISTS incidents_all_superuser ON incidents;
CREATE POLICY incidents_all_superuser ON incidents FOR ALL USING (is_super_admin());

-- 2) عرض «طوعي آمن»: exact_location فقط للملتزمين (RLS على الموقع الدقيق مباشرة) + النطاق الشبيه.
DROP VIEW IF EXISTS incident_locations;
CREATE VIEW incident_locations WITH (security_barrier = true, security_invoker = true) AS
SELECT id, exact_location, accuracy_m, approx_center, approx_radius_m
FROM incidents
WHERE is_committed_responder(id)
   OR requester_id = app_current_user()
   OR (is_super_admin())
   OR EXISTS (SELECT 1 FROM users u
              WHERE u.id = app_current_user() AND u.house_id = incidents.house_id
                AND 'house_admin' = ANY(u.roles) AND incidents.status IN ('open','covered','unresponsive'));

-- 3) الموقع الحي: الملتزمون لما يرون مواقع بعض؛ أمنيًا الملتزم يرى مواقع الفريق.
--    صاحب البلاغ يرى الجميع. اتصالات WebSocket تعيد فحص الصلاحية عند كل اشتراك (11-3).
ALTER TABLE live_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_select ON live_locations;
CREATE POLICY live_select ON live_locations FOR SELECT USING (
  EXISTS (SELECT 1 FROM incidents i WHERE i.id = live_locations.incident_id
    AND (i.requester_id = app_current_user() OR is_committed_responder(i.id)))
  OR user_id = app_current_user()
  OR is_super_admin()
  OR EXISTS (SELECT 1 FROM users u
             WHERE u.id = app_current_user() AND u.house_id = (SELECT house_id FROM incidents i WHERE i.id = live_locations.incident_id)
               AND 'house_admin' = ANY(u.roles)
               AND EXISTS (SELECT 1 FROM incidents i WHERE i.id = live_locations.incident_id
                           AND i.status IN ('open','covered','unresponsive')))
);
DROP POLICY IF EXISTS live_insert_owner ON live_locations;
CREATE POLICY live_insert_owner ON live_locations FOR INSERT
  WITH CHECK (user_id = app_current_user() OR is_super_admin());

-- 4) أرقام الهواتف: لا تُنسخ لصفوف البلاغ (11-7)؛ وصول users مقيد.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users FOR SELECT USING (
  id = app_current_user()
  OR is_super_admin()
  -- أعضاء البيت يرون أنفسهم ومعرفاتهم الأساسية؛ والإدارة تفصّل الأدوار لاحقًا
  OR EXISTS (SELECT 1 FROM users u
             WHERE u.id = app_current_user() AND u.house_id = users.house_id)
);

-- 5) audit_log: append-only — يُحظر UPDATE/DELETE لكل الأدوار (حتى super_admin عبر الدورين).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log FOR SELECT USING (is_super_admin());
-- منع العلوي المطلق (داخلية الـ API تشفّر محتوى الاتصال):
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
