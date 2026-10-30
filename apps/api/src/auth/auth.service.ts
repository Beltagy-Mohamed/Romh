/**
 * AuthService — تسجيل برقم الهاتف مع OTP (5.1)، JWT قصيرة العمر، ربط بالجهاز (17).
 * OTP في Redis؛ التسجيل يبدأ بمطالب هوية إلزامية (الاسم الكامل، العائلة، البيت، الفرع، منطقة الإقامة).
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import crypto from 'crypto';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { DbService, UserRole } from '@/common/db.service';const OTP_TTL = Number(process.env.OTP_TTL_SECONDS ?? 300);

@Injectable()
export class AuthService {
  constructor(private db: DbService) {}

  async findUserIdByPhone(phone: string): Promise<string | null> {
    const r = await this.db.one<{ id: string }>(`SELECT id FROM users WHERE phone_e164=$1`, [phone]);
    return r?.id ?? null;
  }

  /** إرسال OTP — dev: OTP_DEBUG_DEV_CODE يعرض الكود (ولا ينشئ كلفة SMS) */
  async requestOtp(phoneE164: string, ip?: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const redisKey = `otp:${phoneE164}`;
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const attempts = await redis.incr(`otp:attempts:${phoneE164}`);
    if (attempts > 6) { await redis.expire(`otp:attempts:${phoneE164}`, 3600); await redis.quit(); throw new ForbiddenException('rate_limited'); }
    await redis.set(redisKey, code, 'EX', OTP_TTL);
    await redis.quit();
    console.log(`[OTP-stub] ${phoneE164} → ${process.env.OTP_DEBUG_DEV_CODE ? code : '••••••'} (from ${ip ?? 'unknown ip'})`);
    return { ok: true, devCode: process.env.OTP_DEBUG_DEV_CODE ? code : undefined };
  }

  /** تسجيل/دخول: تحقق OTP → إنشاء الحساب في حالة pending (5.4) أو إصدار توكن دخول */
  async verifyOtpAndRegister(input: {
    phone: string; code: string; fullName: string; familyName: string; nickname?: string;
    houseId: string; branchId?: string; homeArea?: string; devicePlatform?: string; deviceToken?: string; inviteCode?: string;
  }) {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const expected = await redis.get(`otp:${input.phone}`);
    await redis.del(`otp:${input.phone}`);
    await redis.quit();
    if (!expected || expected !== input.code) throw new UnauthorizedException('otp_invalid');

    const existing = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE phone_e164=$1`, [input.phone]);
    if (existing) return this.issueTokens(existing.id);

    if (input.phone) {
      const blocked = await this.db.one<{ id: string }>(
        `SELECT id FROM users WHERE phone_e164=$1 AND phone_blocked=true`, [input.phone]);      if (blocked) throw new ForbiddenException('phone_blocked'); // 5.2.3
    }
    // 5.2 — كشف الحساب المرتبط بالجهاز والانتماء الإلزامي
    if (!input.fullName || !input.familyName || !input.houseId) throw new BadRequestException('identity_required');

    const user = await this.db.one<{ id: string }>(
      `INSERT INTO users (phone_e164, full_name, family_name, nickname, house_id, branch_id, home_area, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
      [input.phone, input.fullName, input.familyName, input.nickname ?? null,
       input.houseId, input.branchId ?? null, input.homeArea ?? null]);
    if (!user) throw new BadRequestException('فشل إنشاء الحساب');

    // 5.1 — طلب تزكية تلقائي يحدد «أقرب الأعضاء»(وحدة VouchingService)
    if (input.inviteCode) {
      await this.db.query(
        `UPDATE invites SET invitee_user_id=$1, accepted_at=now() WHERE code=$2 AND invitee_user_id IS NULL`,
        [user.id, input.inviteCode]);
    }
    return this.issueTokens(user.id);
  }

  async loginAfterOtp(phone: string, code: string) {
    const user = await this.db.one<{ id: string }>(
      `SELECT id FROM users WHERE phone_e164=$1 AND phone_blocked=false`, [phone]);
    if (!user) throw new NotFoundException('no_account');
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    const expected = await redis.get(`otp:${phone}`); await redis.del(`otp:${phone}`); await redis.quit();
    if (!expected || expected !== code) throw new UnauthorizedException('otp_invalid');
    return this.issueTokens(user.id);
  }

  issueTokens(userId: string) {
    const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret';
    const ttl = Number(process.env.JWT_TTL_SECONDS ?? 900);
    const accessToken = jwt.sign({ sub: userId }, secret, { expiresIn: ttl });
    const refreshToken = jwt.sign({ sub: userId, typ: 'refresh', jti: crypto.randomUUID() }, secret, {
      expiresIn: Number(process.env.REFRESH_TTL_SECONDS ?? 1209600),
    });
    return { accessToken, refreshToken };
  }

  /** عزل جلسات ورموز الأجهزة فورًا عند سحب العضوية أو الحظر (5.11 و5.2.3) — معيار قبول 5 */
  async revokeAllSessions(userId: string) {
    await this.db.query(`DELETE FROM device_tokens WHERE user_id=$1`, [userId]);
    // أثر إضافي: صلاحيات الاستلام تختفي عبر status=banned/revoked (فحص الـ Guard أعلاه)
  }

  static main() { return void 0; }
}

// ————— Guard —————
export interface JwtPayload { sub: string; typ?: string; role?: UserRole; }

export function makeAuthGuard(db: DbService): CanActivate {
  return {
    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      const req = ctx.switchToHttp().getRequest();
      const auth = String(req.headers.authorization ?? '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query?.token as string | undefined);
      if (!token) throw new UnauthorizedException('missing_token');
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'dev-jwt-secret') as JwtPayload;
        if (payload.typ === 'refresh') throw new UnauthorizedException('refresh_not_accepted');
        const user = await db.one<{ id: string; status: string; roles: string[] }>(
          `SELECT id, status::text, roles FROM users WHERE id=$1`, [payload.sub]);
        if (!user || user.status === 'banned' || user.status === 'revoked' || user.status === 'suspended')
          throw new UnauthorizedException('user_inactive'); // pending: يرى حالته فقط (5.4)
        req.user = { id: user.id, role: (user.roles ?? ['member'])[0] as UserRole, status: user.status };
        return true;
      } catch (e) { throw new UnauthorizedException((e as Error).message); }
    },
  };
}
