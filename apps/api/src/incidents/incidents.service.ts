/**
 * IncidentsService — منطق البلاغ: إنشاء فوري (D-003)، تحديث النوع، الاستجابة الثلاثية (10.1)،
 * الموقع الحي (10.4)، الإغلاق (12)، الإلغاء/PIN الإكراه (13.2).
 * الخصوصية: كل قراءة/إرسال عبر PrivacyService — لا إحداثيات دقيقة وهاتف للغير ملتزم.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DbService, UserRole } from '@/common/db.service';
import { SettingsService } from '@/settings/settings.service';
import { PrivacyService } from '@/incidents/privacy.service';
import { EscalationService } from '@/incidents/escalation.service';
import { AuditService } from '@/common/audit.service';
import { NotifyService } from '@/common/notify.service';

@Injectable()
export class IncidentsService {
  constructor(
    private db: DbService,
    private settings: SettingsService,
    private privacy: PrivacyService,
    private escalation: EscalationService,
    private audit: AuditService,
    private notify: NotifyService,
  ) {}

  // ============ الإنشاء (6) ============
  async create(userId: string, role: UserRole, input: {
    lat: number; lng: number; accuracyM?: number; typeCode?: string; duressPinTransform?: string;
    batteryLevel?: number; networkQuality?: string; moving?: boolean; track?: unknown;
  }) {
    // 6.3 — بلاغ نشط واحد لكل مستخدم
    const active = await this.db.one<{ id: string }>(
      `SELECT id FROM incidents WHERE requester_id=$1 AND status IN ('open','covered','unresponsive')`, [userId]);
    if (active) return { existing: active.id };

    // 6.3 — حد المعدل إلزامي
    const cap = await this.settings.num('incident.rate_limit_hourly', 3);
    const { rowCount: inLastHour } = await this.db.query(
      `SELECT 1 FROM incidents WHERE requester_id=$1 AND created_at > now() - interval '1 hour'`, [userId]);
    const throttled = (inLastHour ?? 0) >= cap;

    const radius = await this.settings.num('privacy.approx_radius_m', 2000);
    const typeCode = input.typeCode ?? 'unspecified';
    const approx = PrivacyService.approxCenterWkt(input.lat, input.lng, radius);

    const incident = await this.db.one<{ id: string }>(
      `INSERT INTO incidents (requester_id, house_id, type_code, duress, exact_location, accuracy_m,
                              approx_center, approx_radius_m, required_responders, context)
       SELECT $1, u.house_id, $2, $3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography, $6,
              ST_GeogFromText($7), $8,
              COALESCE((SELECT min_responders FROM incident_types WHERE code=$2), 2)::smallint,
              $9::jsonb
       FROM users u WHERE u.id=$1 RETURNING id`,
      [userId, typeCode, false, input.lng, input.lat, input.accuracyM ?? null, approx, radius,
       JSON.stringify({ batteryLevel: input.batteryLevel, networkQuality: input.networkQuality, moving: input.moving })]);
    if (!incident) throw new BadRequestException('فشل إنشاء البلاغ');

    await this.db.query(
      `INSERT INTO incident_events (incident_id, event_type, actor_id, data)
       VALUES ($1,'created',$2,$3::jsonb)`,
      [incident.id, userId, JSON.stringify({ throttled, typeCode })]);

    // التجاوز: يوجَّه لأدمن البيت فقط (مراجعة، وليس بث طارئ) — الملاحظة Thuyun
    await this.escalation.schedule(incident.id);

    await this.audit.append({ actorId: userId, action: 'incident_created', targetType: 'incident', targetId: incident.id,
      metadata: { throttled, typeCode, duress: false } });

    return { id: incident.id, throttled };
  }

  /** 6.2 — تحديث النوع/الوصف بعد الإرسال: إعادة حساب التوجيه + تسجيل الحدث */
  async updateType(userId: string, incidentId: string, patch: { typeCode?: string; description?: string; lifeRisk?: boolean }) {
    await this.assertRequester(userId, incidentId);
    if (patch.lifeRisk) {
      // 7 — «خطر على الحياة أو عنف» → سياسة accident + أرقام طوارئ + إشعار أدمن الحالة
      await this.db.query(
        `UPDATE incidents SET type_code='accident' WHERE id=$1 AND requester_id=$2`, [incidentId, userId]);
      await this.db.query(
        `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,'life_risk_flag',$2,'{}'::jsonb)`,
        [incidentId, userId]);
      return this.reEscalate(incidentId);
    }
    if (patch.typeCode) {
      await this.db.query(
        `UPDATE incidents SET type_code=$3 WHERE id=$1 AND requester_id=$2`, [incidentId, userId, patch.typeCode]);
    }
    if (patch.description !== undefined) {
      await this.db.query(`UPDATE incidents SET description=$3 WHERE id=$1 AND requester_id=$2`,
        [incidentId, userId, patch.description]);
    }
    await this.db.query(
      `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,'type_changed',$2,$3::jsonb)`,
      [incidentId, userId, JSON.stringify(patch)]);
    return this.reEscalate(incidentId);
  }

  private async reEscalate(incidentId: string) {
    await this.escalation.cancelAll(incidentId);
    await this.escalation.schedule(incidentId);
  }

  // ============ ack + إشعار تسليم (9.3) ============
  async ack(userId: string, incidentId: string, ring: number) {
    await this.db.query(
      `UPDATE incident_notifications SET delivered_at = now(), opened_at = now()
       WHERE incident_id=$1 AND user_id=$2 AND ring=$3 AND delivered_at IS NULL`,
      [incidentId, userId, ring]);
    // 9.3 — إذا لم يصل ack من 50% من الدائرة 1 خلال 20 ث → قناة SMS بديلة (فحص في job مجدول — M2)
  }

  // ============ أزرار الاستجابة الثلاثة (10.1) ============
  async respond(userId: string, incidentId: string, input: {
    response: 'coming' | 'referred' | 'cannot'; referredToUserId?: string; etaSeconds?: number;
  }) {
    const inc = await this.db.one<{ requester_id: string; type_code: string; status: string }>(
      `SELECT requester_id, type_code, status FROM incidents WHERE id=$1`, [incidentId]);
    if (!inc) throw new NotFoundException('incident_not_found');
    const allowed = await this.getNotifiedInfo(incidentId, userId);
    if (!allowed) throw new ForbiddenException('لم يصلك هذا البلاغ');

    if (input.response === 'coming') {
      // 11 — منع حصاد المواقع: حد أقصى 3 التزامات نشطة
      const capAnd = await this.settings.num('privacy.max_active_committed', 3);
      const { rowCount } = await this.db.query(
        `SELECT 1 FROM incident_responses r JOIN incidents i ON i.id=r.incident_id
         WHERE r.user_id=$1 AND r.status='en_route' AND i.closed_at IS NULL`, [userId]);
      if ((rowCount ?? 0) >= capAnd && inc.requester_id !== userId)
        throw new BadRequestException('تجاوز الحد الأقصى للالتزامات النشطة');
      await this.db.query(
        `INSERT INTO incident_responses (incident_id, user_id, response, eta_seconds, status)
         VALUES ($1,$2,'coming',$3,'en_route')
         ON CONFLICT (incident_id,user_id)
         DO UPDATE SET response='coming', status='en_route', withdrawn_at = NULL, eta_seconds = EXCLUDED.eta_seconds`,
        [incidentId, userId, input.etaSeconds ?? null]);
      await this.logEvent(incidentId, 'coming', userId, { eta: input.etaSeconds });
      this.escalation.recomputeCoverage(incidentId).catch(() => undefined);
    } else if (input.response === 'referred') {
      // 10.1 — إحالة: أولوية الدائرة 1، حد 3 إحالات للشخص في البلاغ
      if (!input.referredToUserId) throw new BadRequestException('referredToUserId مطلوب');
      await this.db.query(
        `INSERT INTO incident_responses (incident_id, user_id, response, referred_to_user_id, status)
         VALUES ($1,$2,'referred',$3,'en_route') ON CONFLICT (incident_id,user_id)
         DO UPDATE SET response='referred', referred_to_user_id=$3`,
        [incidentId, userId, input.referredToUserId]);
      await this.notifyReferral(incidentId, userId, input.referredToUserId);
      await this.logEvent(incidentId, 'referred', userId, { to: input.referredToUserId });
    } else {
      await this.db.query(
        `INSERT INTO incident_responses (incident_id, user_id, response, status) VALUES ($1,$2,'cannot','en_route')
         ON CONFLICT (incident_id,user_id) DO UPDATE SET response='cannot'`,
        [incidentId, userId]);
      await this.logEvent(incidentId, 'cannot', userId, {});
    }
    return { ok: true };
  }

  private async notifyReferral(incidentId: string, fromUserId: string, toUserId: string) {
    // 10.1 — الإحالة = إشعار الدائرة 1 فورًا بغض النظر عن الموقع (9.3)
    const recipient = await this.db.one<{ token: string | null }>(
      `SELECT (SELECT token FROM device_tokens WHERE user_id=$1 LIMIT 1) token`, [toUserId]);
    if (!recipient?.token) return;
    const from = await this.db.one<{ full_name: string }>(`SELECT full_name FROM users WHERE id=$1`, [fromUserId]);
    await this.db.query(
      `INSERT INTO incident_notifications (incident_id, user_id, ring, channel) VALUES ($1,$2,1,'push')`,
      [incidentId, toUserId]);
    await this.notify.pushFCM(recipient.token, {
      incidentId, typeCode: 'referral', ring: 1,
      titleAr: `${from?.full_name ?? 'عضو'} أحالك البلاغ`,
      bodyAr: 'فتُصلحت المطلوب من قريبٌ منك ببلاغٍ حرِج — اضغط للاستجابة',
    }).catch(() => undefined);
  }

  async arrive(userId: string, incidentId: string) {
    await this.assertCommitted(incidentId, userId);
    await this.db.query(
      `UPDATE incident_responses SET status='arrived', arrived_at=now()
       WHERE incident_id=$1 AND user_id=$2 AND status='en_route'`, [incidentId, userId]);
    await this.logEvent(incidentId, 'arrived', userId, {});
    this.escalation.recomputeCoverage(incidentId).catch(() => undefined);
    return { ok: true };
  }

  async withdraw(userId: string, incidentId: string) {
    await this.assertCommitted(incidentId, userId);
    await this.db.query(
      `UPDATE incident_responses SET status='withdrawn', withdrawn_at=now()
       WHERE incident_id=$1 AND user_id=$2`, [incidentId, userId]);
    await this.logEvent(incidentId, 'withdrawn', userId, {});
    this.escalation.responseLost(incidentId, userId).catch(() => undefined);
    return { ok: true };
  }

  /** 10.3 — استبعاد مستجيب: ينسحب صلاحيته فورًا ويتسجل */
  async exclude(userId: string, incidentId: string, targetId: string, role: UserRole) {
    await this.assertRequester(userId, incidentId);
    await this.db.query(
      `UPDATE incident_responses SET status='withdrawn', withdrawn_at=now()
       WHERE incident_id=$1 AND user_id=$2`, [incidentId, targetId]);
    await this.audit.append({ actorId: userId, action: 'responder_excluded', targetType: 'incident',
      targetId: incidentId, metadata: { excluded: targetId, role } });
    this.escalation.responseLost(incidentId, targetId).catch(() => undefined);
    await this.logEvent(incidentId, 'excluded', userId, { target: targetId });
  }

  // ============ الموقع الحي (10.4) ============
  async postLive(userId: string, incidentId: string, lat: number, lng: number, speedKmh?: number) {
    const ent = await this.privacy.entitlement(incidentId, userId, 'member');
    if (!ent.isRequester && !ent.isCommittedResponder) throw new ForbiddenException('no_live_permission');
    await this.db.query(
      `INSERT INTO live_locations (incident_id, user_id, point, speed_kmh, ts)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, now())
       ON CONFLICT (incident_id, user_id)
       DO UPDATE SET point=EXCLUDED.point, speed_kmh=EXCLUDED.speed_kmh, ts=now()`,
      [incidentId, userId, lng, lat, speedKmh ?? null]);
    return { ok: true };
  }

  // ============ إغلاق/إلغاء (12 و13) ============
  async close(userId: string, incidentId: string, reason = 'resolved') {
    const closed = await this.db.query(
      `UPDATE incidents SET status='resolved', closed_at=now(), closed_by=$2, close_reason=$3
       WHERE id=$1 AND requester_id=$2 AND status IN ('open','covered','unresponsive') RETURNING id`,
      [incidentId, userId, reason]);
    if (!closed.rowCount) throw new BadRequestException('لا يمكن الإغلاق');
    await this.escalation.cancelAll(incidentId);
    await this.logEvent(incidentId, 'closed', userId, { reason });
    await this.audit.append({ actorId: userId, action: 'incident_closed', targetType: 'incident', targetId: incidentId, metadata: { reason } });
    return { ok: true, closedAt: true };
  }

  /** 13.2 — الإلغاء بعد الضغط: PIN إلغاء أو PIN إكراه (يُتحقق على الخادم — D-005) */
  async cancelWithPin(userId: string, incidentId: string, pinPlain: string, ip?: string, device?: string) {
    if (await this.isPinLocked(userId)) throw new ForbiddenException('pin_locked');
    const user = await this.db.one<{ pin_cancel_hash: string | null; pin_duress_hash: string | null }>(
      `SELECT pin_cancel_hash, pin_duress_hash FROM users WHERE id=$1`, [userId]);
    if (!user?.pin_cancel_hash) throw new BadRequestException('pin_not_set');

    const isCancel = await bcrypt.compare(pinPlain, user.pin_cancel_hash);
    const isDuress = user.pin_duress_hash ? await bcrypt.compare(pinPlain, user.pin_duress_hash) : false;
    if (!isCancel && !isDuress) {
      await this.db.query(
        `UPDATE users SET pin_failed_attempts = pin_failed_attempts + 1,
           pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE pin_locked_until END
         WHERE id=$1`, [userId]);
      // استجابة زمنية مطابقة بين الحالتين (D-005)
      return { ok: false as const, duress: false };
    }

    // إعادة تصفير المحاولات
    await this.db.query(`UPDATE users SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id=$1`, [userId]);

    if (isDuress) {
      // البلاغ يستمر + duress=true — لا يظهر في سجل صاحب البلاغ (13.2)
      await this.db.query(`UPDATE incidents SET duress=true WHERE id=$1 AND requester_id=$2`, [incidentId, userId]);
      await this.audit.append({ actorId: userId, action: 'duress_pin_used', targetType: 'incident',
        targetId: incidentId, ip, device });
      await this.reEscalate(incidentId);
      return { ok: true as const, duress: true };
    }

    const inc = await this.db.one<{ created_at: Date }>(
      `SELECT created_at FROM incidents WHERE id=$1 AND requester_id=$2`, [incidentId, userId]);
    if (!inc) throw new NotFoundException('incident_not_found');
    const within60s = Date.now() - new Date(inc.created_at).getTime() <= 60_000;
    await this.db.query(
      `UPDATE incidents SET status='cancelled', closed_at=now(), closed_by=$2,
              close_reason=$4 WHERE id=$1 AND requester_id=$2`,
      [incidentId, userId, within60s ? 'cancelled_accidental' : 'cancelled']);
    await this.escalation.cancelAll(incidentId);
    await this.logEvent(incidentId, 'cancelled', userId, { within60s });
    await this.audit.append({ actorId: userId, action: 'incident_cancelled', targetType: 'incident',
      targetId: incidentId, metadata: { within60s } });
    return { ok: true as const, duress: false };
  }

  private async isPinLocked(userId: string) {
    const r = await this.db.one<{ locked: boolean }>(
      `SELECT pin_locked_until > now() AS locked FROM users WHERE id=$1`, [userId]);
    return r?.locked ?? false;
  }

  // ============ قراءة دورية (11) ============
  /** بلاغي النشط — يظهر أيضًا في الإكراه كإلغاء وهمي (13.2: جهاز صاحب البلاغ صامت) */
  async viewMine(userId: string, role: UserRole) {
    const inc = await this.db.one<{ id: string }>(
      `SELECT id FROM incidents WHERE requester_id=$1 AND status IN ('open','covered','unresponsive')`, [userId]);
    if (!inc) return null;
    if (role === 'member') {
      const isDuress = await this.db.one<{ duress: boolean }>(`SELECT duress FROM incidents WHERE id=$1`, [inc.id]);
      if (isDuress?.duress) {
        return { id: inc.id, cancelledIllusion: true }; // واجهة الإلغاء مطابقة؛ البلاغ حي صامت
      }
    }
    return this.view(userId, inc.id, role);
  }

  /** ما يراه صاحب الندا أو المستلم من البلاغ — قوائم أعمدة صريحة (D-004) */
  async view(userId: string, incidentId: string, role: UserRole) {
    const inc = await this.db.one<Record<string, unknown>>(
      `SELECT i.id, i.requester_id, i.type_code, i.status, i.duress, i.description,
              i.required_responders, i.created_at, i.closed_at, i.approx_center, i.approx_radius_m,
              u.full_name || ' ' || u.family_name AS requester_name
       FROM incidents i JOIN users u ON u.id = i.requester_id
       WHERE i.id = $1`, [incidentId]);
    if (!inc) throw new NotFoundException('incident_not_found');

    const ent = await this.privacy.entitlement(incidentId, userId, role);
    // فقط من وصله إشعار (أو الدائرة/الأدمن بنطاقه) يَرى العدّاد؛ الغير يُرفض
    if (!ent.isRequester && !ent.precise && !ent.isHouseAdminActiveIncident) {
      const notified = await this.getNotifiedInfo(incidentId, userId);
      if (!notified) throw new ForbiddenException();
    }

    const base: Record<string, unknown> = { ...inc, entitlement: ent };
    if (!ent.precise) {
      delete base.exact_location; // إخفاء إلزامي — حتى لو أكمل القارئ سلسلته (11-1)
    } else {
      const extra = await this.db.one<{ exact_location: string | null; accuracy_m: string | null }>(
        `SELECT exact_location::text, accuracy_m::text FROM incidents WHERE id=$1`, [incidentId]);
      base.exact_location = extra?.exact_location ?? null;
      base.accuracy_m = extra?.accuracy_m ?? null;
    }

    // بيان الاستجابة وعدّاد (10.2): أسماء + حالات، بلا مواقع
    const { rows: responders } = await this.db.query<{ user_id: string; name: string; response: string; status: string; eta_seconds: number | null }>(
      `SELECT r.user_id, (u.full_name || ' ' || u.family_name) AS name, r.response, r.status, r.eta_seconds
       FROM incident_responses r JOIN users u ON u.id = r.user_id
       WHERE r.incident_id=$1 AND r.response IN ('coming','referred')`, [incidentId]);
    const committed = responders.filter((r) => r.status === 'en_route' || r.status === 'arrived');
    base.responders = responders;
    base.counter = {
      enRoute: committed.filter((r) => r.status === 'en_route').length,
      arrived: committed.filter((r) => r.status === 'arrived').length,
    };
    return base;
  }

  private async getNotifiedInfo(incidentId: string, userId: string) {
    return await this.db.one<{ ring: number }>(
      `SELECT max(ring) ring FROM incident_notifications WHERE incident_id=$1 AND user_id=$2`,
      [incidentId, userId]) as { ring: number } | null;
  }

  private async assertRequester(userId: string, incidentId: string) {
    const ok = await this.db.one<{ id: string }>(
      `SELECT id FROM incidents WHERE id=$1 AND requester_id=$2`, [incidentId, userId]);
    if (!ok) throw new ForbiddenException('only requester');
  }

  private async assertCommitted(incidentId: string, userId: string) {
    const ok = await this.db.one<{ id: string }>(
      `SELECT id FROM incident_responses WHERE incident_id=$1 AND user_id=$2
         AND status IN ('en_route','arrived')`, [incidentId, userId]);
    if (!ok) throw new ForbiddenException('not committed');
  }

  private async logEvent(incidentId: string, type: string, actor: string | null, data: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,$2,$3,$4::jsonb)`,
      [incidentId, type, actor, JSON.stringify(data)]);
  }
}
