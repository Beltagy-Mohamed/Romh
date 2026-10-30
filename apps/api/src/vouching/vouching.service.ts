/**
 * VouchingService — التسجيل بالتزكية (5 و 5.1 اختيار «أقرب الأعضاء» تلقائيًا).
 * معايير القبول (1.1): الطلب يصل لأقرب 5 خلال 60 ثانية؛ لا يُرسل لغير موثق/محظور/تجاوز سقفه.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@/common/db.service';
import { SettingsService } from '@/settings/settings.service';
import { NotifyService } from '@/common/notify.service';

@Injectable()
export class VouchingService {
  constructor(
    private db: DbService,
    private settings: SettingsService,
    private notify: NotifyService,
  ) {}

  /** إرسال الدفعة من «أقرب الأعضاء» — يُستدعى فور إرسال طلب الانضمام (5.5) */
  async dispatchBatch(subjectUserId: string, batchNo = 1): Promise<number> {
    const subject = await this.db.one<{
      id: string; family_name: string; house_id: string; branch_id: string; home_point: string;
    }>(`SELECT id, family_name, house_id, branch_id, home_point FROM users WHERE id=$1`, [subjectUserId]);
    if (!subject) throw new NotFoundException();

    const capMonthly = await this.settings.num('vouch.monthly_cap', 5);
    const capDaily = await this.settings.num('vouch.daily_batch_size', 5);
    const trustedDays = await this.settings.num('vouch.trusted_after_days', 30);
    const w = {
      familyBranch: await this.settings.num('weights.family_branch', 40),
      family: await this.settings.num('weights.family', 30),
      house: await this.settings.num('weights.house', 15),
      geo: await this.settings.num('weights.geo_near', 10),
      cleanLog: await this.settings.num('weights.clean_vouchee_log', 3),
      activity: await this.settings.num('weights.recent_activity', 2),
    };

    // ترتيب القرب (5.1) — أوزان من الإعدادات، ليست ثوابت كود
    const batchSize = await this.settings.num('vouch.daily_batch_size', 5);
    const { rows: candidates } = await this.db.query<{ id: string; token: string | null; score: number }>(
      `SELECT u.id, (SELECT token FROM device_tokens t WHERE t.user_id=u.id LIMIT 1) AS token,
         -- صاحب سجل تزكيات سليم: عنصر من الوزن (إن لم يُحظر أحد ممن زكّاهم) — 5.1
         ($10::int * (1 - LEAST(1, COALESCE((
             SELECT count(*) FILTER (WHERE ug.status = 'banned')::float
             FROM vouches vv JOIN users ug ON ug.id = vv.subject_user_id
             WHERE vv.voucher_user_id = u.id AND vv.status = 'accepted'), 0)::float)))
         + ($11::int * (1 - LEAST(1, COALESCE(
             EXTRACT(EPOCH FROM (now() - u.last_seen_at)) / 86400.0, 99)::float)))                                 -- الأكثر نشاطًا مؤخرًا
         + CASE WHEN u.family_name = $3 AND u.branch_id IS NOT DISTINCT FROM $2 THEN $7::int ELSE 0 END            -- عائلة+فرع
         + CASE WHEN u.family_name = $3 THEN $8::int ELSE 0 END                                                    -- عائلة
         + CASE WHEN u.house_id = $4 THEN $9::int ELSE 0 END                                                       -- بيت
         - COALESCE((SELECT (ST_Distance(u.home_point, $1::geography) / 1000.0)  -- الأقرب جغرافيًا (بسلب ليعمل DESC)
                     WHERE u.home_point IS NOT NULL AND $1::geography IS NOT NULL), 99999)
         + $12::int * 0 -- مكان إضافي محفوظ (بلا تغيير في الترتيب الافتراضي)
         AS score
       FROM users u
       WHERE u.id <> $5 AND u.status = 'active' AND u.availability = 'available'
         AND (u.is_founder OR u.approved_at < now() - ($6::int || ' days')::interval)   -- «عضو موثق» = 5.6
         AND NOT EXISTS (SELECT 1 FROM ban_cascade bc
                         WHERE bc.voucher_user_id = u.id AND bc.status IN ('frozen','objection_window','banned'))
         AND (SELECT count(*) FROM vouches v WHERE v.voucher_user_id = u.id AND v.status='accepted'
                AND v.created_at > date_trunc('month', now())) < $13::int                -- سقف شهري
         AND (SELECT count(*) FROM vouches v WHERE v.voucher_user_id = u.id
                AND v.status IN ('requested','declined','unknown')
                AND v.created_at > now() - (CASE WHEN $14::int = 1 THEN interval '24 hours' ELSE interval '24 hours' END)) < $15::int -- حد 3/يوم (5.1)
         AND NOT EXISTS (SELECT 1 FROM vouches v WHERE v.subject_user_id = $5 AND v.voucher_user_id = u.id)
       ORDER BY score DESC
       LIMIT $14::int`,
      [subject.home_point ?? null, subject.branch_id ?? null, subject.family_name, subject.house_id,
       subjectUserId, trustedDays, w.familyBranch, w.family, w.house,
       w.cleanLog, w.activity, 0, capMonthly, batchSize, 3],
    );

    for (const c of candidates) {
      await this.db.query(
        `INSERT INTO vouches (subject_user_id, voucher_user_id, status, batch_no) VALUES ($1,$2,'requested',$3)`,
        [subjectUserId, c.id, batchNo]);
      if (c.token) {
        const subj = await this.db.one<{ full_name: string; family_name: string; house_label: string }>(
          `SELECT u.full_name, u.family_name, h.name AS house_label FROM users u
           JOIN houses h ON h.id=u.house_id WHERE u.id=$1`, [subjectUserId]);
        await this.notify.pushFCM(c.token, {
          incidentId: `vouch:${subjectUserId}`, typeCode: 'vouch_request', ring: 0,
          titleAr: 'طلب تزكية', bodyAr: `${subj?.full_name} ${subj?.family_name} — من بيت ${subj?.house_label}`,
        }).catch(() => undefined);
      }
    }
    return candidates.length;
  }

  /** رد المزكّي — الإقرار الصريح إلزامي قبله (5.1 و5.6) */
  async respond(voucherUserId: string, vouchId: string, decision: 'accepted' | 'declined' | 'unknown', responsibilityAck: boolean) {
    if (decision === 'accepted' && !responsibilityAck)
      throw new BadRequestException('الإقرار الصريح مطلوب قبل التزكية');
    const updated = await this.db.query(
      `UPDATE vouches SET status=$3, responsibility_ack_at = CASE WHEN $3='accepted' THEN now() ELSE NULL END,
              responded_at=now()
       WHERE id=$1 AND voucher_user_id=$2 AND status='requested' RETURNING subject_user_id`,
      [vouchId, voucherUserId, decision]);
    if (!updated.rowCount) throw new NotFoundException('vouch_not_requested');

    const subject = updated.rows[0].subject_user_id;
    if (decision === 'accepted') {
      const count = await this.db.one<{ accepted: number }>(
        `SELECT count(*)::int accepted FROM vouches WHERE subject_user_id=$1 AND status='accepted'`, [subject]);
      await this.db.query(
        `UPDATE membership_requests SET vouches_accepted = GREATEST(vouches_accepted, $2) WHERE user_id=$1`,
        [subject, count?.accepted ?? 0]);
    }
    // رفضان صريحان أو أكثر → أولوية أعلى إلى أدمن البيت (5.1)
    await this.db.query(
      `UPDATE membership_requests SET status='escalated', escalated_at=now()
       WHERE user_id=$1 AND status='pending'
         AND (SELECT count(*) FROM vouches WHERE subject_user_id=$1 AND status='declined') >= 2`,
      [subject]);
    return { ok: true };
  }

  /** ما يراه المزكّي: الاسم والعائلة والبيت والفرع — لا هاتف كامل (5.1) */
  async forVoucher(voucherUserId: string) {
    return await this.db.query(
      `SELECT v.id, v.batch_no, u.full_name, u.family_name, u.nickname, h1.name AS house_name, h2.name AS branch_name
       FROM vouches v JOIN users u ON u.id=v.subject_user_id
       LEFT JOIN houses h1 ON h1.id=u.house_id LEFT JOIN houses h2 ON h2.id=u.branch_id
       WHERE v.voucher_user_id=$1 AND v.status='requested'`, [voucherUserId]);
  }
}
