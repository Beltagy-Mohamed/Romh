/**
 * NotifyService — FCM + SMS + الاتصال الآلي.
 * مزودات stub الآن؛ التبديل عبر SMS_PROVIDER/FCM_SERVER_KEY دون تغيير المنطق (16.1).
 * موثوقية الإشعار: رسائل data+notification أولوية high على قناة fazaa_critical (FCM Android)؛
 * مصدر الحقيقة للتسليم هو ack الجهاز — لا يُفترض النجاح من الـ API.
 */
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DbService } from '@/common/db.service';

export interface PushPayload {
  incidentId: string;
  typeCode: string;
  titleAr: string;   // «أحمد يطلب الفزعة» — لا «SOS» (22)
  bodyAr: string;
  ring: number;      // لتحديد Trucks متعددة للدوائر المتعددة
}

@Injectable()
export class NotifyService {
  private logger = new Logger(NotifyService.name);
  private redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  constructor(private db: DbService) {}

  async pushFCM(token: string, payload: PushPayload): Promise<{ sent: boolean }> {
    if (!process.env.FCM_SERVER_KEY) {
      this.logger.warn(`[FCM-stub] → ${token.slice(0, 8)}… ring${payload.ring} ${payload.typeCode}`);
      return { sent: false };
    }
    // TODO(المرحلة 1): FCM HTTP v1 — data:{incidentId, ring} + notification
    //   android:{ priority:'high', notification:{ channel_id:'fazaa_critical', sound:'bedouin_call' } }
    return { sent: false };
  }

  async sendSMS(phoneE164: string, body: string): Promise<boolean> {
    const month = new Date().toISOString().slice(0, 7);
    const daily = Number((await this.redis.incr(`sms:count:${month}`)) * 0.25).toFixed(2);
    const cap = Number(process.env.SMS_BUDGET_MONTHLY_EGP ?? 500);
    if (Number(daily) > cap) {
      this.logger.error(`تجاوز ميزانية SMS الشهرية — إيقاف الإرسال حتى المراجعة.`);
      return false;
    }
    this.logger.log(`[SMS-stub] → ${phoneE164}: ${body.slice(0, 60)}`);
    return true;
  }

  async autoCall(phoneE164: string, promptAr: string): Promise<boolean> {
    this.logger.log(`[CALL-stub] → ${phoneE164}: ${promptAr}`);
    return false; // إصدار 1.1: مكالمة صوتية آلية (20)
  }

  /** 16.1 — اختبار الإشعار الإلزامي قبل تفعيل الحساب */
  sendTestPush(token: string): Promise<{ sent: boolean }> {
    return this.pushFCM(token, {
      incidentId: 'test', typeCode: 'test', ring: 0,
      titleAr: 'اختبار الفَزْعة',
      bodyAr: 'أقر بأنك استلمت الإشعار — اضغط تأكيد الوصول في التطبيق.',
    });
  }

  /** ack تسليم من الجهاز → incident_notifications.delivered_at (9.3) */
  async markDelivered(incidentId: string, userId: string, ring: number, channel = 'push'): Promise<void> {
    await this.db.query(
      `UPDATE incident_notifications SET delivered_at = now()
       WHERE incident_id=$1 AND user_id=$2 AND ring=$3 AND channel=$4 AND delivered_at IS NULL`,
      [incidentId, userId, ring, channel],
    );
  }
}
