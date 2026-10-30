/** Controller عام: أرقام الطوارئ (عام) + الملف الشخصي والقدرات وPIN (محمي) */
import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import { DbService, UserRole } from '@/common/db.service';
import { makeAuthGuard } from '@/auth/auth.service';
import { NotifyService } from '@/common/notify.service';

function user(req: Request): { id: string; role: UserRole; status?: string } {
  return (req as never as { user: { id: string; role: UserRole; status?: string } }).user;
}

/** 1) عام — أرقام الطوارئ تعمل حتى دون دخول (14.1): النسخة المحلية داخل التطبيق)
 * التحديث يعمل بالإنترنت مع النسخة المحلية fallback */
@Controller('api/v1')
class EmergencyController {
  constructor(private db: DbService) {}
  @Get('emergency-numbers')
  async list() {
    const r = await this.db.query<{ label: string; number: string; governorate: string | null }>(
      `SELECT label, number, governorate FROM emergency_numbers ORDER BY sort`);
    return r.rows; // نسخة محلية داخل التطبيق تكفيOffline؛ هذا نقطة آخر تحديث
  }
}

/** 2) محمي — الملف الشخصي والقدرات وPIN والوضع */
@Controller('api/v1')
@UseGuards(makeAuthGuard(new DbService())) // TODO(M2): وحدة Provider مركزية بدل حقنة مباشرة
export class CoreController {
  constructor(private db: DbService, private notify: NotifyService) {}

  @Get('me')
  async me(@Req() req: Request) {
    const u = user(req);
    return await this.db.one(
      `SELECT id, full_name, family_name, nickname, house_id, branch_id, status::text, roles,
              availability::text, availability_until,
              pin_cancel_hash IS NOT NULL AS pin_cancel_set,
              pin_duress_hash IS NOT NULL AS pin_duress_set,
              notif_test_confirmed_at
       FROM users WHERE id=$1`, [u.id]);
  }

  /** 8 — القدرات: اختيار متعدد وتعديل في أي وقت (كل تعديل يُسجَّل) */
  @Put('me/capabilities')
  async setCapabilities(@Req() req: Request, @Body() body: { capabilities: { code: string; details?: object }[] }) {
    const u = user(req);
    await this.db.tx(async (c) => {
      await c.query(`DELETE FROM user_capabilities WHERE user_id=$1`, [u.id]);
      for (const cap of body.capabilities ?? []) {
        await c.query(
          `INSERT INTO user_capabilities (user_id, capability_code, details) VALUES ($1,$2,$3::jsonb)`,
          [u.id, cap.code, JSON.stringify(cap.details ?? {})]);
      }
    });
    return { ok: true };
  }

  /** 13.2 — ضبط PIN الإلغاء وPIN الإكراه المختلفين (bcrypt على الخادم — D-005) */
  @Post('me/pins')
  async setPins(@Req() req: Request, @Body() body: { pinCancel: string; pinDuress: string }) {
    const u = user(req);
    if (body.pinCancel === body.pinDuress)
      return { ok: false, error: 'pin_duress_must_differ' };
    await this.db.query(
      `UPDATE users SET pin_cancel_hash=$2, pin_duress_hash=$3,
              pin_failed_attempts=0, pin_locked_until=NULL WHERE id=$1`,
      [u.id, await bcrypt.hash(body.pinCancel, 10), await bcrypt.hash(body.pinDuress, 10)]);
    return { ok: true };
  }

  /** 9.3 — «غير متاح»: يستبعد تلقائيًا من الدائرتين 1 و2 (لا يتلقى إلا صامتًا في الدائرة 3) */
  @Put('me/availability')
  async setAvailability(@Req() req: Request, @Body() body: {
    availability: 'available' | 'unavailable' | 'until_ts'; until?: string }) {
    const u = user(req);
    await this.db.query(
      `UPDATE users SET availability=$2::availability, availability_until=$3 WHERE id=$1`,
      [u.id, body.availability, body.until ?? null]);
    return { ok: true };
  }

  /** 16.1 — اختبار الإشعار الإلزامي (يرسل تجربة ويثبت تأكيد الوصول قبل تفعيل الحساب) */
  @Post('me/notif-test')
  async notifTest(@Req() req: Request, @Body() body: { deviceToken: string }) {
    const u = user(req);
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO device_tokens (user_id, platform, token) VALUES ($1,'unknown',$2)
         ON CONFLICT (user_id, token) DO UPDATE SET last_active_at = now()`,
        [u.id, body.deviceToken]);
    });
    const r = await this.notify.sendTestPush(body.deviceToken).catch(() => ({ sent: false }));
    return { ...r, note: 'عند ظهور إشعار التجربة اضغط «تأكيد الوصول» في التطبيق' };
  }

  @Post('me/notif-test/confirm')
  async notifTestConfirm(@Req() req: Request) {
    const u = user(req);
    await this.db.query(`UPDATE users SET notif_test_confirmed_at=now() WHERE id=$1`, [u.id]);
    return { ok: true };
  }
}

export { EmergencyController };
