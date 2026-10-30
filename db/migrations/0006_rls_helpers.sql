-- 0006: إصلاح RLS — دوال SECURITY DEFINER لكسر التكرار (recursive policy) في users.
-- القاعدة: السياسات لا تسأل الجدول الذي تحميه؛ تسأل دالة تعمل بصلاحية المالك مباشرة.
CREATE OR REPLACE FUNCTION app_my_house() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT house_id FROM public.users WHERE id = app_current_user() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_has_role(p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.users WHERE id = app_current_user() AND p_role = ANY(roles) LIMIT 1)
$$;

DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users FOR SELECT USING (
  id = app_current_user()
  OR app_has_role('super_admin')
  OR house_id = app_my_house()
);

-- البلاغات: إعادة صياغة بشرط أدمن البيت عبر الدوال الجديدة
DROP POLICY IF EXISTS incidents_select ON incidents;
CREATE POLICY incidents_select ON incidents FOR SELECT USING (
  requester_id = app_current_user()
  OR is_committed_responder(id)
  OR is_super_admin()
  OR (app_has_role('house_admin') AND house_id = app_my_house())
  OR (app_my_house() IS NOT NULL AND house_id = app_my_house())
);

-- العرض الآمن للمواقع: نفس المنطق (القسم 11)
DROP VIEW IF EXISTS incident_locations;
CREATE VIEW incident_locations WITH (security_barrier = true, security_invoker = true) AS
SELECT id, exact_location, accuracy_m, approx_center, approx_radius_m
FROM incidents
WHERE is_committed_responder(id)
   OR requester_id = app_current_user()
   OR is_super_admin()
   OR (app_has_role('house_admin') AND house_id = app_my_house()
        AND status IN ('open','covered','unresponsive'));
