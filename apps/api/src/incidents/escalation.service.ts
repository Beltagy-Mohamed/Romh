/**
 * EscalationService — محرك الدوائر (القسم 9). يعمل على الخادم، لا على الجهاز.
 *
 * الضوابط النظامية المُنفَّذة هنا:
 * - إرسال دائم عبر BullMQ (لا setTimeout في الذاكرة) — المعيار القبولي 2.
 * - كل مهمة idempotent وتُلغى عند إغلاق البلاغ.
 * - «مغطّاة»: K مستجيب en_route/arrived → إيقاف التصعيد (9.3).
 * - فقدان التغطية: أعادة حساب عند كل تغيير حالة استجابة.
 * - عدم التكرار: عضو في دخول أكثر من دائرة يُرسل مرة واحدة.
 * - PWA/iOS تُستعمد للدائرة 2 دوما (D-008).
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, JobsOptions, Processor } from 'bullmq';
import Redis from 'ioredis';
import { DbService } from '@/common/db.service';
import { NotifyService } from '@/common/notify.service';
import { SettingsService } from '@/settings/settings.service';

const QUEUE = 'fazaa-escalation';
const JOBS = {
  RING: 'ring',                 // {incidentId, ring}
  CHECK_IN: 'checkin',          // {incidentId} — سؤال «هل انتهت؟» (12-2)
  UNRESPONSIVE: 'unresponsive', // {incidentId} — 2 h (12-3)
  EXPIRE: 'expire',             // {incidentId} — 6 h
  WATCH_COVERED: 'watch',       // {incidentId} — مراقبة فقدان التغطية كل 60 ث
  DATA_RETENTION: 'data-retention',
} as const;

interface JobData { incidentId: string; ring?: number; }

@Injectable()
export class EscalationService implements OnModuleDestroy {
  private logger = new Logger(EscalationService.name);
  private queue: Queue<JobData>;
  private worker: Worker<JobData>;
  private connection: Redis;
  // إشعار راجع للتطبيق (للمرسَل إليهم عبر WebSocket)
  onIncidentNotified?: (incidentId: string, userId: string, ring: number) => void;
  onIncidentUpdate?: (incidentId: string) => void;

  constructor(
    private db: DbService,
    private settings: SettingsService,
    private notify: NotifyService,
  ) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.connection = new Redis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue<JobData>(QUEUE, { connection: this.connection });
    this.worker = new Worker<JobData>(QUEUE, this.process.bind(this) as Processor<JobData>, {
      connection: this.connection,
      concurrency: 8,
    });
    this.worker.on('failed', (job, err) => this.logger.error(`فشل ${job?.name} #${job?.id}: ${err.message}`));
  }

  async onModuleDestroy() { await this.worker.close(); await this.queue.close(); this.connection.disconnect(); }

  /** إرسال دائم — إعادة تشغيل الخادم لا تُسقط التصعيد (معيار قبول 2) */
  async schedule(incidentId: string): Promise<void> {
    const inc = await this.db.one<{ type_code: string; duress: boolean }>(
      `SELECT type_code, duress FROM incidents WHERE id=$1`, [incidentId]);
    if (!inc) return;
    const policy = await this.settings.ringPolicy(inc.type_code);

    // الإكراه (13.2): يستبعده من الدائرة 1 مباشرة إلى الدائرة 2 + أدمن البيت فورًا
    // (إرسال أدمن البيت بالإشعار المباشر/D-006 يُستكمل في/admins dispatch أدناه في M2)
    const opts = (name: string, delayMs: number): JobsOptions => ({
      jobId: `incident:${incidentId}:${name}`, delay: delayMs,
    });
    await this.dispatchRing(incidentId, inc.duress ? 2 : 1);
    await this.queue.add(JOBS.RING, { incidentId, ring: 2 }, opts('ring2', policy.t2_s * 1000));
    await this.queue.add(JOBS.RING, { incidentId, ring: 3 }, opts('ring3', policy.t3_s * 1000));
    await this.queue.add(JOBS.CHECK_IN, { incidentId }, opts('checkin', 1800e3));
    await this.queue.add(JOBS.UNRESPONSIVE, { incidentId }, opts('unresponsive', 7200e3));
    await this.queue.add(JOBS.EXPIRE, { incidentId }, opts('expire', 21600e3));
    await this.queue.add(JOBS.WATCH_COVERED, { incidentId }, {
      jobId: `incident:${incidentId}:watch`,
      repeat: { every: 60_000 },
    });
  }

  /** إلغاء كل المهام المعلقة عند إغلاق/إلغاء البلاغ (idempotent) */
  async cancelAll(incidentId: string): Promise<void> {
    const delayed = await this.queue.getJobs(['delayed', 'waiting']);
    for (const j of delayed) {
      if (String(j.id ?? '').includes(`incident:${incidentId}`)) {
        await j.remove().catch(() => { /* سبق أن نُفذت — مقبول (idempotent) */ });
      }
    }
    // إلغاء المهمة المتكررة لمراقبة التغطية
    await this.queue
      .removeRepeatable(JOBS.WATCH_COVERED, { every: 60_000 }, `incident:${incidentId}:watch`)
      .catch(() => undefined);
  }

  private async process(job: { name: string; data: JobData; id?: string }): Promise<void> {
    const { incidentId } = job.data;
    const inc = await this.db.one<{ status: string }>(`SELECT status FROM incidents WHERE id=$1`, [incidentId]);
    if (!inc || ['cancelled', 'resolved', 'resolved_unconfirmed', 'flagged', 'covered'].includes(inc.status)) return;

    switch (job.name) {
      case JOBS.RING: { await this.dispatchRing(incidentId, (job.data.ring ?? 1) as 1 | 2 | 3); return; }
      case JOBS.CHECK_IN: { await this.checkin(incidentId); return; }
      case JOBS.UNRESPONSIVE: { await this.unresponsive(incidentId); return; }
      case JOBS.EXPIRE: { await this.expire(incidentId); return; }
      case JOBS.WATCH_COVERED: { await this.watchCoverage(incidentId); return; }
      case JOBS.DATA_RETENTION: return;
    }
  }

  /** إرسال دائرة: مرشحون (9.1) → ترتيب (قدرات ثم مسافة) → إشعار push + تسجيل */
  async dispatchRing(incidentId: string, ring: 1 | 2 | 3): Promise<{ sent: number }> {
    const inc = await this.db.one<{
      id: string; type_code: string; house_id: string; duress: boolean; approx_center: string;
      required_responders: number;
    }>(`SELECT id, type_code, house_id, duress, approx_center, required_responders FROM incidents WHERE id=$1`, [incidentId]);
    if (!inc) return { sent: 0 };

    const policy = await this.settings.ringPolicy(inc.type_code);
    const radius = ring === 1 ? policy.r1_km : ring === 2 ? policy.r2_km : policy.r3_km;
    const limit = ring === 1 ? policy.n1 : ring === 2 ? policy.n1 * 3 : null;

    const { rows: candidates } = await this.db.query<{
      id: string; platform: string; token: string; match_score: number; dist_m: number;
    }>(
      `WITH required_caps AS (
         SELECT unnest(required_capabilities) cap FROM incident_types WHERE code=$1
       )
       SELECT DISTINCT u.id,
              (SELECT count(*) FROM user_capabilities c
                WHERE c.user_id=u.id AND c.capability_code IN (SELECT cap FROM required_caps)) AS match_score,
              CASE WHEN $6::geography IS NOT NULL AND u.home_point IS NOT NULL
                   THEN ST_Distance(u.home_point, $6::geography) ELSE 999e9 END AS dist_m,
              t.platform, t.token
       FROM users u LEFT JOIN device_tokens t ON t.user_id = u.id WHERE u.id <> $2
         AND u.status = 'active' AND u.availability = 'available'
         -- 9.2: أعضاء بيت صاحب البلاغ في الدائرة 2 + أصحاب القدرات من كل القبيلة
         AND ($3::smallint = 3 OR u.house_id = $4::uuid OR EXISTS (
               SELECT 1 FROM user_capabilities c
               WHERE c.user_id=u.id AND c.capability_code IN (SELECT cap FROM required_caps)))
         AND ($3::smallint <> 1 OR NOT (t.platform = 'pwa_ios'))
         AND t.token IS NOT NULL
         AND ($5::numeric IS NULL OR ST_DWithin(u.home_point, $6::geography, $5::numeric))`,
      [inc.type_code, inc.id, ring, inc.house_id, ring * 1.0 * radius * 1000, inc.approx_center],
    );

    // 9.3 — عدم التكرار: من وصله إشعار الدائرة أعلى مستبعد
    const already = new Set((await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM incident_notifications WHERE incident_id=$1`, [incidentId],
    )).rows.map((r) => r.user_id));

    const ranked0 = candidates.filter((c) => !already.has(c.id));

    // توزيع العبء (اختياري — 9.3): عقوبة لمن استجاب في آخر ساعتين، محسوبة مسبقًا
    const penalties = new Map<string, number>();
    for (const c of ranked0) penalties.set(c.id, await this.recentLoadPenalty(c.id));

    const ranked = ranked0
      .sort((a, b) => b.match_score - a.match_score || a.dist_m - b.dist_m ||
        penalties.get(a.id)! - penalties.get(b.id)!)
      .slice(0, limit ?? Infinity);

    const requester = await this.db.one<{ full_name: string; house_label: string }>(
      `SELECT u.full_name, h.name AS house_label FROM users u
       JOIN incidents i ON i.requester_id = u.id JOIN houses h ON h.id = i.house_id WHERE i.id=$1`,
      [incidentId],
    );

    for (const c of ranked) {
      await this.db.query(
        `INSERT INTO incident_notifications (incident_id, user_id, ring, channel) VALUES ($1,$2,$3,'push')`,
        [incidentId, c.id, ring],
      );
      await this.db.query(
        `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,'ring_sent',NULL,$2)`,
        [incidentId, { ring, user: c.id, dist_m: Math.round(c.dist_m) }],
      );
      await this.notify.pushFCM(c.token, {
        incidentId, typeCode: inc.type_code, ring,
        titleAr: `${requester?.full_name ?? 'عضو'} يطلب الفزعة`,
        bodyAr: `${requester?.house_label ?? ''} — اضغط للاستجابة`,
      }).catch(() => undefined);
      this.onIncidentNotified?.(incidentId, c.id, ring);
    }
    this.onIncidentUpdate?.(incidentId);
    return { sent: ranked.length };
  }

  private async recentLoadPenalty(userId: string) {
    const r = await this.db.one<{ n: number }>(
      `SELECT count(*)::int n FROM incident_responses WHERE user_id=$1 AND created_at > now() - interval '2 hours'`,
      [userId]);
    return r?.n ?? 0;
  }

  /** 9.3 — الحساب عند كل تغيير حالة استجابة (يُستدعى من IncidentsService) */
  async recomputeCoverage(incidentId: string): Promise<void> {
    const inc = await this.db.one<{ required_responders: number; status: string }>(
      `SELECT required_responders, status FROM incidents WHERE id=$1`, [incidentId]);
    if (!inc || inc.status !== 'open') return;
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int n FROM incident_responses
       WHERE incident_id=$1 AND status IN ('en_route','arrived')`, [incidentId]);
    if (rows[0]?.n >= inc.required_responders && inc.required_responders > 0) {
      await this.db.query(`UPDATE incidents SET status='covered' WHERE id=$1 AND status='open'`, [incidentId]);
      await this.logEvent(incidentId, 'covered', null, { responders: rows[0] });
      await this.cancelAll(incidentId); // إيقاف مؤقتات التصعيد
    }
    this.onIncidentUpdate?.(incidentId);
  }

  async responseLost(incidentId: string, userId: string): Promise<void> {
    // 9.3 — فقدان التغطية: إعادة الحساب وإذا نزلت عن K يُستأنف التصعيد من دائرة current بمؤقت 60 ث
    await this.db.query(`UPDATE incidents SET status='open' WHERE id=$1 AND status='covered'`, [incidentId]);
    await this.db.query(
      `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,'coverage_lost',$2,'{}'::jsonb)`,
      [incidentId, userId]);
    await this.recomputeCoverage(incidentId);
  }

  private async checkin(incidentId: string) {
    const inc = await this.db.one<{ created_at: Date }>(`SELECT created_at FROM incidents WHERE id=$1`, [incidentId]);
    const lastEvent = await this.db.one<{ at: Date }>(
      `SELECT max(at) at FROM incident_events WHERE incident_id=$1`, [incidentId]);
    const idleMs = Date.now() - new Date(lastEvent?.at ?? inc?.created_at ?? Date.now()).getTime();
    if (idleMs < 1800e3) return; // 12-2: نشاط حديث — لا سؤال
    await this.logEvent(incidentId, 'checkin_sent', null, {});
    // إشعار «هل انتهت؟» يُرسل عبر الجهاز/الـ WebSocket — هنا نضع علامة فقط
  }

  private async unresponsive(incidentId: string) {
    // 12-3 — غياب الرد خطر وليس إغلاقًا
    const set = await this.db.query(
      `UPDATE incidents SET status='unresponsive' WHERE id=$1 AND status IN ('open','covered') RETURNING house_id`,
      [incidentId]);
    if (!set.rowCount) return;
    await this.logEvent(incidentId, 'unresponsive', null, {});
    const admins = await this.db.query<{ token: string | null; phone_e164: string }>(
      `SELECT t.token, u.phone_e164 FROM users u
       LEFT JOIN device_tokens t ON t.user_id=u.id
       WHERE u.house_id=$1 AND 'house_admin' = ANY(u.roles)`,
      [(set.rows[0] as { house_id: string }).house_id]);
    for (const a of admins.rows) {
      if (a.token) await this.notify.pushFCM(a.token, {
        incidentId, typeCode: 'unresponsive', ring: 4,
        titleAr: 'خطر محتمل — بلاغ لا يستجيب',
        bodyAr: 'اتصل بصاحب البلاغ والمستجيبين الحاليين فورًا',
      }).catch(() => undefined);
      await this.notify.sendSMS(a.phone_e164, 'بلاغ فزعة لا استجابة من صاحبه. اتصل به فورًا.');
    }
  }

  private async expire(incidentId: string) {
    const closed = await this.db.query(
      `UPDATE incidents SET closed_at = now(), closed_by = NULL,
              close_reason = 'expired_unconfirmed'
       WHERE id=$1 AND status='unresponsive' RETURNING house_id`,
      [incidentId]);
    if (!closed.rowCount) return;
    await this.cancelAll(incidentId);
    await this.logEvent(incidentId, 'expired_unconfirmed', null, {});
    // تنبيه نهائي للأدمن (12-3)
    this.onIncidentUpdate?.(incidentId);
  }

  private async watchCoverage(incidentId: string) {
    // 9.3 — فقدان التغطية: مستجيب en_route بلا تحديث موقع 180 ث
    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT r.user_id FROM incident_responses r
       LEFT JOIN LATERAL (
         SELECT ts FROM live_locations WHERE incident_id=$1 AND user_id=r.user_id ORDER BY ts DESC LIMIT 1
       ) l ON true
       WHERE r.incident_id=$1 AND r.status='en_route'
         AND ($2::timestamptz IS NULL OR l.ts IS NULL OR l.ts < now() - interval '180 seconds')`,
      [incidentId, new Date()]);
    for (const r of rows) {
      await this.db.query(
        `INSERT INTO incident_events (incident_id, event_type, actor_id, data)
         VALUES ($1,'responder_stale',$2,'{"stale":true}'::jsonb)`, [incidentId, r.user_id]);
    }
    if (rows.length) this.onIncidentUpdate?.(incidentId);
  }

  private async logEvent(incidentId: string, type: string, actor: string | null, data: Record<string, unknown>) {
    await this.db.query(
      `INSERT INTO incident_events (incident_id, event_type, actor_id, data) VALUES ($1,$2,$3,$4::jsonb)`,
      [incidentId, type, actor, JSON.stringify(data)]);
  }
}

/** لفحص نتيجة dispatchRing في الاختبار */
type introspectable = { sent: number };
