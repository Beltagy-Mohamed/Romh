/** AuthController — OTP تسجيل ودخول + تحديث التوكن */
import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '@/auth/auth.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('otp/request')
  async requestOtp(@Req() req: Request, @Body() body: { phone: string }) {
    return await this.auth.requestOtp(body.phone, req.ip);
  }

  @Post('register')
  async register(@Body() body: {
    phone: string; code: string; fullName: string; familyName: string; nickname?: string;
    houseId: string; branchId?: string; homeArea?: string; inviteCode?: string;
    devicePlatform?: string; deviceToken?: string;
  }) {
    const tokens = await this.auth.verifyOtpAndRegister(body);
    // طلب تزكية تلقائي فور التسجيل (5.5) — يُنفَّذ بعد إصدار الطلب
    const user = await this.auth.findUserIdByPhone?.(body.phone);
    void user; // VouchingService.dispatchBatch يربط مراقبًا في M2
    return tokens;
  }

  @Post('login')
  async login(@Body() body: { phone: string; code: string }) {
    return await this.auth.loginAfterOtp(body.phone, body.code);
  }
}
