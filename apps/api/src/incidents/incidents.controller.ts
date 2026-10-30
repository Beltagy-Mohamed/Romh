/**
 * IncidentsController — نقاط النهاية (كلها تحقق RLS + PrivacyService ثم تسجل).
 * جميع المسارات تحت /api/v1
 */
import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { IncidentsService } from '@/incidents/incidents.service';
import { DbService } from '@/common/db.service';
import { makeAuthGuard } from '@/auth/auth.service';
import { UserRole } from '@/common/db.service';

@Controller('api/v1/incidents')
@UseGuards(makeAuthGuard(new DbService())) // TODO(M2): حقنة DI نظيفة عبر Reflector/Global guards
export class IncidentsController {
  constructor(private incidents: IncidentsService) {}

  @Get('active')
  async myActive(@Req() req: Request) {
    const u = (req as never as { user: { id: string; role: UserRole } }).user;
    return await this.incidents.viewMine(u.id, u.role);
  }

  /** الإرسال الفوري بنوع «غير محدد» — D-003 (لا حقول إجبارية بعد الضغط) */
  @Post()
  async create(@Req() req: Request, @Body() body: {
    lat: number; lng: number; accuracyM?: number; typeCode?: string;
    batteryLevel?: number; networkQuality?: string; moving?: boolean;
  }) {
    const u = (req as never as { user: { id: string; role: UserRole } }).user;
    return await this.incidents.create(u.id, u.role, body);
  }

  /** تحديث النوع/الوصف تلقائيًا بعد الإرسال (6.2) */
  @Put(':id')
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: { typeCode?: string; description?: string; lifeRisk?: boolean }) {
    const u = (req as never as { user: { id: string; role: UserRole } }).user;
    return await this.incidents.updateType(u.id, id, body);
  }

  @Get(':id')
  async view(@Req() req: Request, @Param('id') id: string) {
    const u = (req as never as { user: { id: string; role: UserRole } }).user;
    return await this.incidents.view(u.id, id, u.role);
  }

  /** ack تسليم الجهاز (9.3) */
  @Post(':id/ack')
  async ack(@Req() req: Request, @Param('id') id: string, @Body() body: { ring: number }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.ack(u.id, id, body.ring);
  }

  /** الأزرار الثلاثة (10.1) */
  @Post(':id/respond')
  async respond(@Req() req: Request, @Param('id') id: string, @Body() body: {
    response: 'coming' | 'referred' | 'cannot'; referredToUserId?: string; etaSeconds?: number;
  }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.respond(u.id, id, body);
  }

  @Post(':id/arrive')
  async arrive(@Req() req: Request, @Param('id') id: string) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.arrive(u.id, id);
  }

  @Post(':id/withdraw')
  async withdraw(@Req() req: Request, @Param('id') id: string) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.withdraw(u.id, id);
  }

  /** استبعاد مستجيب (10.3) */
  @Post(':id/exclude')
  async exclude(@Req() req: Request, @Param('id') id: string, @Body() body: { userId: string }) {
    const u = (req as never as { user: { id: string; role: UserRole } }).user;
    return await this.incidents.exclude(u.id, id, body.userId, u.role);
  }

  /** الموقع الحي (10.4) — ملتزم فقط؛ WebSocket يستقبل التحديثات من هنا */
  @Post(':id/live')
  async live(@Req() req: Request, @Param('id') id: string, @Body() body: { lat: number; lng: number; speedKmh?: number }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.postLive(u.id, id, body.lat, body.lng, body.speedKmh);
  }

  /** تمت الفزعة (12) */
  @Post(':id/close')
  async close(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.close(u.id, id, body.reason ?? 'resolved');
  }

  /** إلغاء 10 ث + PIN — PIN الإكراه هنا (13.2) */
  @Post(':id/cancel')
  async cancel(@Req() req: Request, @Param('id') id: string, @Body() body: { pin: string }) {
    const u = (req as never as { user: { id: string } }).user;
    return await this.incidents.cancelWithPin(u.id, id, body.pin,
      (req as never as { ip?: string }).ip, req.headers['user-agent']);
  }
}
