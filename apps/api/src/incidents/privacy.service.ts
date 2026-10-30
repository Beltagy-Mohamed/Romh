/**
 * PrivacyService — الخصوصية على مرحلتين (القسم 11). إلزامي، لا اجتهاد:
 * 1) نقطة المركز التقريبي تُحسب مرة واحدة (إزاحة عشوائية ≤ 0.6×نصف القطر) ولا تُعاد —
 *    حتى لا يستنتج الموقع الحقيقي بمتوسط عدة قراءات.
 * 2) صلاحية الموقع الدقيق = صف en_route/arrived (فحص عند كل طلب وكل اشتراك WebSocket).
 * 3) الردود تُصاغ هنا: قوائم أعمدة صريحة — لا SELECT * ولا right وفرة ضمنية.
 */
import { Injectable } from '@nestjs/common';
import { DbService, UserRole } from '@/common/db.service';

export interface Entitlement {
  isRequester: boolean;
  isCommittedResponder: boolean;
  isHouseAdminActiveIncident: boolean;
  /** يرى الدقيق؟ (نادرًا ما يجتمع — لا يرى أحد إلا بدليل event قابل للتسجيل) */
  precise: boolean;
  /** صلاحية شابتر Wi-Fi؟ يُستخدم للـ WebSocket والجريان الحي */
  live: boolean;
}

@Injectable()
export class PrivacyService {
  constructor(private db: DbService) {}

  /**
   * 11 — التنفيذ: إزاحة عشوائية بمسافة 0.6×R في اتجاه عشوائي؛ تُحسب مرة واحدة عند الإنشاء.
   * إرجاع WKT جاهزة للـ ST_GeogFromText.
   */
  static approxCenterWkt(lat: number, lng: number, radiusM: number): string {
    const r = radiusM * 0.6 * Math.random();
    const theta = Math.random() * 2 * Math.PI;
    const dLat = (r * Math.cos(theta)) / 111_320;
    const dLng = (r * Math.sin(theta)) / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return `SRID=4326;POINT(${(lng + dLng).toFixed(6)} ${(lat + dLat).toFixed(6)})`;
  }

  /** التخويل الحالي — يُستدعى عند كل طلب وكل اشتراك (11-2) */
  async entitlement(incidentId: string, userId: string, role: UserRole): Promise<Entitlement> {
    const inc = await this.db.one<{ requester_id: string; house_id: string; status: string; closed_at: string | null }>(
      `SELECT requester_id, house_id, status, closed_at FROM incidents WHERE id = $1`, [incidentId],
    );
    if (!inc) throw new Error('incident_not_found');

    const [committed] = (await this.db.query<{ u: number }>(
      `SELECT 1 AS u FROM incident_responses
       WHERE incident_id=$1 AND user_id=$2 AND status IN ('en_route','arrived')`,
      [incidentId, userId],
    )).rows.length === 1 ? [true as boolean] : [false as boolean];

    const [admin] = (await this.db.query<{ u: number }>(
      `SELECT 1 AS u FROM users WHERE id=$1 AND house_id=$2 AND 'house_admin' = ANY(roles)`,
      [userId, inc.house_id],
    )).rows.length === 1 ? [true as boolean] : [false as boolean];

    const active = ['open', 'covered', 'unresponsive'].includes(inc.status);
    const isRequester = inc.requester_id === userId;

    return {
      isRequester,
      isCommittedResponder: committed,
      isHouseAdminActiveIncident: admin && active,
      precise: committed || isRequester || (admin && active) || role === 'super_admin',
      live: committed || isRequester || (admin && active),
    };
  }

  /** مسافة مختصرة للقراءة العادية: كم، أو 30+ كم (11-جدول) */
  static distanceLabel(meters: number): string {
    if (meters >= 30_000) return 'أكبر من 30 كم';
    return `${Math.max(1, Math.round(meters / 1000))} كم`;
  }

  /** التنظيف الدوري — القسم 11-6 و11-7. Job يومي في BullMQ (escalation.processor) */
  async retainDataCleanup(): Promise<void> {
    await this.db.tx(async (c) => {
      // إحداثيات الدقيق والمسار الحي يُحذف بعد 30 يومًا من الإغلاق؛
      // يبقى ملخص إحصائي (النوع، منطقة تقريبية geohash5، التوقيتات، الأعداد).
      await c.query(`
        UPDATE incidents
        SET exact_location  = NULL,
            accuracy_m      = NULL,
            approx_center   = ST_SnapToGrid(approx_center, 5000.0)::geography,
            approx_radius_m = 5000
        WHERE closed_at < now() - interval '30 days' AND exact_location IS NOT NULL`);
      await c.query(`DELETE FROM live_locations WHERE ts < now() - interval '6 hours'`);
    });
  }
}
