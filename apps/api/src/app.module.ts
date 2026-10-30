import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  console.warn('[fazaa] DATABASE_URL غير مضبوطة — راجع apps/api/.env.example');
}
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DbService } from '@/common/db.service';
import { SettingsService } from '@/settings/settings.service';
import { AuditService } from '@/common/audit.service';
import { NotifyService } from '@/common/notify.service';
import { PrivacyService } from '@/incidents/privacy.service';
import { EscalationService } from '@/incidents/escalation.service';
import { IncidentsService } from '@/incidents/incidents.service';
import { IncidentsController } from '@/incidents/incidents.controller';
import { VouchingService } from '@/vouching/vouching.service';
import { VouchingController } from '@/vouching/vouching.controller';
import { EmergencyController, CoreController } from '@/core/core.controller';
import { RealtimeGateway } from '@/realtime/realtime.gateway';
import { AuthService } from '@/auth/auth.service';
import { AuthController } from '@/auth/auth.controller';

/**
 * AppModule — هيكل المرحلة 1 مسطّح عمدًا (عددا الملفات متوسط، والتقسيم للوحدات كامل في M2).
 * القاعدة الحاكمة: المكثف تقني هذا أداة للقراءة، ليس تحملاً للـ singleton كمساند ميتة.
 */
@Module({
  providers: [
    DbService, SettingsService, AuditService, NotifyService, RealtimeGateway,
    PrivacyService, EscalationService, IncidentsService, VouchingService, AuthService,
  ],
  controllers: [IncidentsController, VouchingController, EmergencyController, CoreController, AuthController],
  exports: [DbService, SettingsService, EscalationService, PrivacyService, RealtimeGateway, AuditService],
})
export class AppModule {}
