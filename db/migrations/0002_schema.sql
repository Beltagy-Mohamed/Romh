-- 0002: المخطط الأساسي — القسم 4 + 5.2 + 24.7 من الوثيقة
-- ملاحظة: لا تُجمَّع الإحداثيات الدقيقة في صفوف تمتد للعملاء؛ يقرؤها الخادم حسب التخويل فقط (D-004).

-- ===== التنظيم القبلي =====
CREATE TABLE houses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  parent_id   uuid REFERENCES houses(id)          -- null = بيت، قيمة = فرع
                                    ON DELETE RESTRICT,
  level       smallint NOT NULL DEFAULT 0,        -- 0=بيت، 1=فرع
  wasm_label  text,                               -- «وسم البيت» — رمزه (القسم 22)
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true
);

-- ===== الأعضاء =====
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164           text UNIQUE NOT NULL,
  full_name            text NOT NULL,
  family_name          text NOT NULL,
  nickname             text,
  house_id             uuid REFERENCES houses(id) ON DELETE RESTRICT,
  branch_id            uuid REFERENCES houses(id) ON DELETE RESTRICT,
  home_area            text,                        -- منطقة إقامة تقريبية (وصف حر)
  home_point           geography(point,4326),       -- نقطة مركز المنطقة (اختياري، للتوجيه فقط)
  status               user_status NOT NULL DEFAULT 'pending',
  roles                text[] NOT NULL DEFAULT '{member}', -- member|house_admin|mediator|super_admin|deputy|auditor
  availability         availability NOT NULL DEFAULT 'available',
  availability_until   timestamptz,
  is_founder           boolean NOT NULL DEFAULT false,   -- «أعضاء مؤسسون» بلا تزكية
  pin_cancel_hash      text,                        -- D-005: bcrypt
  pin_duress_hash      text,
  pin_failed_attempts  smallint NOT NULL DEFAULT 0,
  pin_locked_until     timestamptz,
  last_seen_geohash6   text,
  last_seen_at         timestamptz,
  approved_by          uuid REFERENCES users(id),
  approved_at          timestamptz,
  revoked_by           uuid REFERENCES users(id),
  revoked_at           timestamptz,
  revoke_reason        text,
  banned_by            uuid REFERENCES users(id),
  banned_at            timestamptz,
  ban_reason           text,
  phone_blocked        boolean NOT NULL DEFAULT false,
  notif_test_confirmed_at timestamptz,              -- اختبار الإشعار الإلزامي (16.1)
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_house   ON users(house_id) WHERE status = 'active';
CREATE INDEX idx_users_status  ON users(status);
CREATE INDEX idx_users_name    ON users USING gin (full_name gin_trgm_ops);

-- ===== القرابة =====
CREATE TABLE kin_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relative_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  degree             smallint NOT NULL CHECK (degree IN (1,2,3)),
  relation_type      text NOT NULL,   -- father|mother|brother|sister|son|daughter|spouse|...
  confirmed_by_both  boolean NOT NULL DEFAULT false,  -- الدرجة 1 لا تُعتمد في التوجيه إلا بتأكيد الطرفين
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, relative_id),
  CHECK (user_id <> relative_id)
);

-- ===== التزكية (5 + 5.1) =====
CREATE TABLE vouches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voucher_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                 vouch_status NOT NULL DEFAULT 'requested',
  responsibility_ack_at  timestamptz,       -- لحظة «أزكّيه» مع الإقرار الصريح
  batch_no               smallint NOT NULL DEFAULT 1,
  responded_at           timestamptz,
  revoked_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_user_id, voucher_user_id)
);
CREATE INDEX idx_vouches_subject ON vouches(subject_user_id);
CREATE INDEX idx_vouches_voucher ON vouches(voucher_user_id) WHERE status = 'accepted';

CREATE TABLE invites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code            text UNIQUE NOT NULL,
  invitee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz
);

-- ===== طلبات الانضمام (5.3–5.8) =====
CREATE TABLE membership_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  house_id               uuid NOT NULL REFERENCES houses(id) ON DELETE RESTRICT,
  status                 mr_status NOT NULL DEFAULT 'pending',
  reviewer_id            uuid REFERENCES users(id),
  vouches_required       smallint NOT NULL DEFAULT 2,   -- قابل للضبط (settings)
  vouches_accepted       smallint NOT NULL DEFAULT 0,
  escalated_at           timestamptz,
  verification_call_done boolean NOT NULL DEFAULT false,
  verification_call_note text,
  notes                  text,
  decided_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, house_id)
);
CREATE INDEX idx_mr_house_pending ON membership_requests(house_id, status);

-- ===== القدرات (8) =====
CREATE TABLE capabilities_catalog (
  code       text PRIMARY KEY,
  label_ar   text NOT NULL,
  category   text NOT NULL DEFAULT 'general',
  is_active  boolean NOT NULL DEFAULT true
);

CREATE TABLE user_capabilities (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability_code  text NOT NULL REFERENCES capabilities_catalog(code),
  details          jsonb,                     -- نوع السيارة، سعة خزان الماء...
  available_hours  jsonb,
  verified_by      uuid REFERENCES users(id),  -- علامة «موثّق» (doctor/nurse فقط — 1.1)
  verified_at      timestamptz,
  PRIMARY KEY (user_id, capability_code)
);

-- ===== أنواع البلاغات (7) — قابلة للتعديل دون نشر =====
CREATE TABLE incident_types (
  code                   text PRIMARY KEY,
  label_ar               text NOT NULL,
  icon                   text,               -- SVG asset key (هوية بدوية)
  requires_location      boolean NOT NULL DEFAULT true,
  broadcast_scope        text NOT NULL DEFAULT 'house', -- house|tribe|admins_only
  ring_policy            jsonb NOT NULL,     -- دوائر/أنصاف/مؤقتات لكل نوع
  required_capabilities  text[] NOT NULL DEFAULT '{}',
  min_responders         smallint NOT NULL DEFAULT 2,
  show_emergency_numbers boolean NOT NULL DEFAULT false,
  allow_live_location    boolean NOT NULL DEFAULT true,
  push_priority          text NOT NULL DEFAULT 'high',
  active                 boolean NOT NULL DEFAULT true
);

-- ===== البلاغات =====
CREATE TABLE incidents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id        uuid NOT NULL REFERENCES users(id),
  house_id            uuid NOT NULL REFERENCES houses(id),
  type_code           text NOT NULL REFERENCES incident_types(code), -- 'unspecified' الافتراضي (D-003)
  status              inc_status NOT NULL DEFAULT 'open',
  duress              boolean NOT NULL DEFAULT false,
  exact_location      geography(point,4326),
  accuracy_m          numeric,
  approx_center       geography(point,4326),  -- يحسب مرة واحدة بإزاحة عشوائية (11)
  approx_radius_m     numeric NOT NULL DEFAULT 2000,
  description         text,
  required_responders smallint NOT NULL DEFAULT 2,
  context             jsonb,                  -- بطارية، شبكة، متحرك/ثابت، آخر 5 دقائق مسار (6.2)
  created_at          timestamptz NOT NULL DEFAULT now(),  -- بتوقيت الخادم = مصدر الحقيقة
  closed_at           timestamptz,
  closed_by           uuid REFERENCES users(id),
  close_reason        text
);

CREATE INDEX idx_incidents_house_status ON incidents(house_id, status);
CREATE INDEX idx_incidents_requester    ON incidents(requester_id) WHERE status IN ('open','covered','unresponsive');
CREATE INDEX idx_incidents_exact_gix    ON incidents USING gist (exact_location);
CREATE INDEX idx_incidents_approx_gix   ON incidents USING gist (approx_center);

CREATE TABLE incident_notifications (
  incident_id  uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  ring         smallint NOT NULL,
  channel      notif_channel NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,   -- من ack الجهاز
  opened_at    timestamptz,
  PRIMARY KEY (incident_id, user_id, ring, channel)
);

CREATE TABLE incident_responses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id        uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id),
  response           resp_kind NOT NULL,
  referred_to_user_id uuid REFERENCES users(id),
  eta_seconds        integer,
  status             resp_status NOT NULL DEFAULT 'en_route',
  created_at         timestamptz NOT NULL DEFAULT now(),
  arrived_at         timestamptz,
  withdrawn_at       timestamptz,
  UNIQUE (incident_id, user_id)
);
CREATE INDEX idx_resp_incident ON incident_responses(incident_id, status);

CREATE TABLE live_locations (                       -- مؤقتة TTL (Redis أولًا؛ جدول كاحتياط)
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  point       geography(point,4326) NOT NULL,
  speed_kmh   numeric,
  ts          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (incident_id, user_id)
);
CREATE INDEX idx_live_gix ON live_locations USING gist (point);

CREATE TABLE incident_events (                      -- خط زمني append-only
  id          bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  event_type  text NOT NULL,      -- created|type_changed|ring_sent|coming|arrived|withdrawn|excluded|...
  actor_id    uuid REFERENCES users(id),
  data        jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_incident ON incident_events(incident_id, at);

-- ===== سجل العمليات (15.2) — append-only بـ hash chain =====
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  approver_id uuid REFERENCES users(id),
  metadata    jsonb,
  device      text,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now(),
  prev_hash   text NOT NULL,
  hash        text NOT NULL        -- sha256(id|actor|action|target|prev_hash|canonical(metadata))
);
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);
CREATE INDEX idx_audit_actor  ON audit_log(actor_id, at);

-- ===== البلاغات الكاذبة (13.1) =====
CREATE TABLE strikes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  incident_id       uuid REFERENCES incidents(id),
  kind              strike_kind NOT NULL,
  decided_by        uuid NOT NULL REFERENCES users(id),
  restriction_until timestamptz,
  reason            text NOT NULL,
  reviewed_by       uuid,           -- الاعتراض يراجعه أدمن آخر
  at                timestamptz NOT NULL DEFAULT now()
);

-- ===== الحظر وسلسلته (5.2) =====
CREATE TABLE ban_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES users(id),
  raised_by       uuid NOT NULL REFERENCES users(id),
  status          ban_status NOT NULL DEFAULT 'suspected',
  evidence_notes  text,
  decided_by      uuid[] NOT NULL DEFAULT '{}',   -- موافقة أدمنين
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ban_cascade (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid NOT NULL REFERENCES ban_cases(id) ON DELETE CASCADE,
  voucher_user_id uuid NOT NULL REFERENCES users(id),
  status          cascade_status NOT NULL DEFAULT 'frozen',
  objection_text  text,
  reviewed_by     uuid REFERENCES users(id),       -- أدمن غير من قرّر
  executes_at     timestamptz,                     -- مهلة اعتراض 48 ساعة
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== الطوارئ والأجهزة =====
CREATE TABLE emergency_numbers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country     text NOT NULL DEFAULT 'EG',
  governorate text,                                -- تخصيص حسب المحافظة
  label       text NOT NULL,
  number      text NOT NULL,
  sort        smallint NOT NULL DEFAULT 0
);

CREATE TABLE device_tokens (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform       text NOT NULL,          -- android|pwa_ios|web
  token          text NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

-- ===== شجرة رمح (24.7) =====
CREATE TABLE lineage_disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raised_by   uuid NOT NULL REFERENCES users(id),
  parent_id   uuid NOT NULL REFERENCES users(id),
  child_id    uuid NOT NULL REFERENCES users(id),
  status      dispute_status NOT NULL DEFAULT 'raised',
  decided_by  uuid REFERENCES users(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coverage_cells (        -- خريطة الظل: أرقام مجمّعة فقط، بلا هويات
  geohash5                text PRIMARY KEY,
  active_responders_count smallint NOT NULL DEFAULT 0,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ===== الإعدادات = Remote Config (الوثيقة: كل رقم قابل للضبط) =====
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- ===== من يرى ماذا (D-006: صلاحيات بيانات لا شروط كود) =====
CREATE TABLE role_permissions (
  role        text NOT NULL,
  permission  text NOT NULL,   -- مثل view_active_incident_precise، close_administratively
  house_scope text NOT NULL DEFAULT 'own_house', -- own_house|all|none
  PRIMARY KEY (role, permission)
);
