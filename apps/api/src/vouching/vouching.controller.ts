/** VouchingController — طلبات التزكية الواردة والرد عليها (5.6) */
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { VouchingService } from '@/vouching/vouching.service';
import { DbService, UserRole } from '@/common/db.service';
import { makeAuthGuard } from '@/auth/auth.service';

@Controller('api/v1/vouches')
@UseGuards(makeAuthGuard(new DbService()))
export class VouchingController {
  constructor(private vouching: VouchingService, private db: DbService) {}

  @Get('incoming')
  async incoming(@Req() req: Request) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.vouching.forVoucher(u.id);
  }

  /** الردود: «أزكّيه» (مع الإقرار)، «لا أعرفه»، «أرفض» (5.1) */
  @Post(':id/respond')
  async respond(@Req() req: Request, @Param('id') id: string, @Body() body: {
    decision: 'accepted' | 'declined' | 'unknown'; responsibilityAck: boolean }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.vouching.respond(u.id, id, body.decision, body.responsibilityAck);
  }

  @Post('respond')
  async respondBySubject(@Req() req: Request, @Body() body: {
    subjectUserId: string; decision: 'accepted' | 'declined' | 'unknown'; responsibilityAck: boolean }) {
    const u = (req as never as { user: { id: string } }).user;
    // إذا كان للمستخدم طلب معلق لهذا الشخص، أجب عليه
    const v = await this.db.one<{ id: string }>(
      `SELECT id FROM vouches WHERE subject_user_id=$1 AND voucher_user_id=$2 AND status='requested'`,
      [body.subjectUserId, u.id]);
    if (!v) return { ok: false, error: 'not_requested' };
    return await this.vouching.respond(u.id, v.id, body.decision, body.responsibilityAck);
  }
}

export { UserRole };
